import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { GithubAuth } from '../../identity/application/github-auth.service';
import { IngestionService } from '../../ingestion/application/ingestion.service';
import { SettingsService } from '../../settings/application/settings.service';
import { selectContext } from '../domain/context-budget';
import {
  BOOTSTRAP_SYSTEM,
  buildBootstrapUser,
} from '../domain/bootstrap-prompt';
import { LlmClientFactory } from '../infrastructure/llm-client.factory';
import {
  GithubWritebackClient,
  WritebackConflictError,
} from '../infrastructure/github-writeback.client';

const STATUS_PATH = 'docs/STATUS.md';
const COMMIT_MESSAGE = 'proplan: bootstrap de STATUS.md';
const MAX_INPUT_TOKENS = 12_000;
const MAX_OUTPUT_TOKENS = 2048;

@Injectable()
export class BootstrapService {
  private readonly logger = new Logger(BootstrapService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auth: GithubAuth,
    private readonly settings: SettingsService,
    private readonly llmFactory: LlmClientFactory,
    private readonly writeback: GithubWritebackClient,
    private readonly ingestion: IngestionService,
  ) {}

  /** Gera uma proposta de STATUS.md (não commita). Retorna o markdown. */
  async proposeStatus(
    userId: string,
    projectId: string,
  ): Promise<{ content: string }> {
    const project = await this.owned(userId, projectId);
    const docs = await this.prisma.document.findMany({
      where: { projectId },
      select: { path: true, content: true },
    });
    if (docs.length === 0) {
      throw new NotFoundException('Projeto sem documentação para inferir status');
    }
    const context = selectContext(docs, MAX_INPUT_TOKENS);
    const provider = await this.settings.providerOf(userId);
    const client = this.llmFactory.create(provider);
    const today = new Date().toISOString().slice(0, 10);

    const res = await client.complete({
      system: BOOTSTRAP_SYSTEM,
      user: buildBootstrapUser(context, today),
      maxTokens: MAX_OUTPUT_TOKENS,
    });
    return { content: stripFences(res.text) };
  }

  /**
   * Commita o STATUS.md revisado no branch default e re-sincroniza.
   * Conflito de SHA → re-sync + 1 retentativa; persistindo → 409 para a UI.
   */
  async commitStatus(
    userId: string,
    projectId: string,
    content: string,
  ): Promise<{ syncRunId: string }> {
    const project = await this.owned(userId, projectId);
    // Escrita → installation token (identidade proplan[bot], ADR-015). É a
    // prova viva do critério de aceite do autor bot da SPEC-008.
    const token = await this.auth.installationToken(projectId);

    for (let attempt = 0; attempt < 2; attempt++) {
      const baseSha = await this.writeback.getFileSha(
        token,
        project.owner,
        project.name,
        STATUS_PATH,
        project.defaultBranch,
      );
      try {
        await this.writeback.putFile({
          token,
          owner: project.owner,
          repo: project.name,
          path: STATUS_PATH,
          branch: project.defaultBranch,
          content,
          message: COMMIT_MESSAGE,
          baseSha,
        });
        // Commit ok → re-sync para o índice local refletir (ADR-009).
        return this.ingestion.enqueueSync(projectId);
      } catch (err) {
        if (err instanceof WritebackConflictError && attempt === 0) {
          this.logger.warn(
            `Conflito no bootstrap do projeto ${projectId} — re-sync e retry`,
          );
          continue; // relê o SHA e tenta uma vez
        }
        if (err instanceof WritebackConflictError) {
          throw new ConflictException(
            'STATUS.md mudou no repositório durante a edição. Re-sincronize e revise.',
          );
        }
        throw err;
      }
    }
    throw new ConflictException('Não foi possível commitar após retry.');
  }

  private async owned(userId: string, projectId: string) {
    const project = await this.prisma.project.findFirst({
      where: { id: projectId, userId },
    });
    if (!project) throw new NotFoundException('Projeto não encontrado');
    return project;
  }
}

/** Remove cercas ```markdown que o modelo às vezes adiciona apesar do prompt. */
function stripFences(text: string): string {
  const trimmed = text.trim();
  const fence = /^```[a-z]*\n([\s\S]*?)\n```$/i.exec(trimmed);
  return (fence ? fence[1] : trimmed).trim() + '\n';
}
