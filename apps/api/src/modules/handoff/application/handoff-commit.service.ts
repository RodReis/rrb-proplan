import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { GithubAuth } from '../../identity/application/github-auth.service';
import {
  GithubWritebackClient,
  WritebackConflictError,
} from '../../../shared/github/github-writeback.client';
import { HandoffService } from './handoff.service';
import { HANDOFF_COMMIT_MESSAGE } from '../domain/handoff';

/** O handoff é artefato do ProPlan (ADR-014), NUNCA conteúdo humano — mora em
 *  `.proplan/`, fora de `docs/`, para não mascarar o alerta de defasagem do
 *  ADR-010. Sobrescreve; o git dá o histórico (decisão 2 do PI — sem tabela). */
const HANDOFF_PATH = '.proplan/HANDOFF.md';

/**
 * Write-back do handoff em `.proplan/HANDOFF.md` (SPEC-018 §5). Reusa o
 * write-back `fetch` compartilhado (installation token, `proplan[bot]`,
 * ADR-015) — o mesmo padrão de ProjectionService; Octokit é ESM-only e não
 * volta (CLAUDE.md). Conflito de SHA → re-lê e tenta 1x.
 */
@Injectable()
export class HandoffCommitService {
  private readonly logger = new Logger(HandoffCommitService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auth: GithubAuth,
    private readonly writeback: GithubWritebackClient,
    private readonly handoff: HandoffService,
  ) {}

  /** Regera o markdown e commita. Retorna false em falha não-fatal (a UI avisa;
   *  o dono já tem o download). Nunca lança. */
  async commit(userId: string, projectId: string): Promise<boolean> {
    const project = await this.prisma.project.findFirst({
      where: { id: projectId, userId },
    });
    if (!project) return false;

    const content = await this.handoff.assembleMarkdown(userId, projectId);
    const token = await this.auth.installationToken(projectId);

    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const baseSha = await this.writeback.getFileSha(
          token,
          project.owner,
          project.name,
          HANDOFF_PATH,
          project.defaultBranch,
        );
        await this.writeback.putFile({
          token,
          owner: project.owner,
          repo: project.name,
          path: HANDOFF_PATH,
          branch: project.defaultBranch,
          content,
          message: HANDOFF_COMMIT_MESSAGE,
          baseSha,
        });
        return true;
      } catch (err) {
        if (err instanceof WritebackConflictError && attempt === 0) continue;
        this.logger.error(
          `Falha ao commitar o handoff do projeto ${projectId}: ${
            err instanceof Error ? err.message : err
          }`,
        );
        return false;
      }
    }
    return false;
  }
}
