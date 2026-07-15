import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { GithubAuth } from '../../identity/application/github-auth.service';
import {
  GithubWritebackClient,
  WritebackConflictError,
} from '../../../shared/github/github-writeback.client';
import { IngestionService } from '../../ingestion/application/ingestion.service';
import { GithubGitClient } from '../../ingestion/infrastructure/github-git.client';
import { ActivityService } from '../../activity/application/activity.service';
import {
  AssertionStatus,
  ContextAssertion,
  parseContextMd,
  revalidationStatus,
  serializeContextMd,
} from '../domain/context-doc';

const CONTEXT_PATH = 'docs/CONTEXT.md';

/**
 * Cap de checagens de validade por sync (Decisão 2 do PI, SPEC-015): 1 request
 * à Commits API por path citado por asserção `vigente`. Estourou → as restantes
 * mantêm o status do arquivo; o próximo sync continua.
 */
const MAX_VALIDITY_CHECKS_PER_SYNC = 30;

export interface AssertionView {
  id: string;
  statement: string;
  paths: string[];
  author: string;
  assertedAt: string;
  assertedSha: string;
  status: AssertionStatus;
  body: string;
}

/**
 * Cofre da asserção humana (SPEC-015, ADR-013). O repo é a fonte —
 * `docs/CONTEXT.md` é conteúdo humano escrito pelo ProPlan como teclado
 * (installation token, ADR-015); a tabela `Assertion` é índice reconstruível.
 * Captura e revalidação seguem o shape do promote/putMapping: Operation com
 * passos nomeados (SPEC-010) + write-back com baseSha + re-sync SHA-aware.
 * Zero IA.
 */
@Injectable()
export class ContextService {
  private readonly logger = new Logger(ContextService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auth: GithubAuth,
    private readonly writeback: GithubWritebackClient,
    private readonly ingestion: IngestionService,
    private readonly git: GithubGitClient,
    private readonly activity: ActivityService,
  ) {}

  private async assertOwner(userId: string, projectId: string) {
    const project = await this.prisma.project.findFirst({
      where: { id: projectId, userId },
    });
    if (!project) throw new NotFoundException('Projeto não encontrado');
    return project;
  }

  /** Asserções do projeto (a marca `a-revalidar` NUNCA é omitida — SPEC-015). */
  async list(userId: string, projectId: string): Promise<AssertionView[]> {
    await this.assertOwner(userId, projectId);
    return this.assertionsOf(projectId);
  }

  /** Interface pública para o canonical projetar `constraints` (ADR-001). */
  async assertionsOf(projectId: string): Promise<AssertionView[]> {
    const rows = await this.prisma.assertion.findMany({
      where: { projectId },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map((r) => ({
      id: r.id,
      statement: r.statement,
      paths: r.paths,
      author: r.author,
      assertedAt: r.assertedAt,
      assertedSha: r.assertedSha,
      status: r.status as AssertionStatus,
      body: r.body,
    }));
  }

  /**
   * Captura uma asserção: autor (usuário), data (hoje) e sha (head do repo)
   * preenchidos pelo ProPlan; texto + paths vêm do dono. Append no CONTEXT.md
   * e write-back — o banco só muda no re-sync (o repo é a fonte).
   */
  async capture(
    userId: string,
    projectId: string,
    input: { statement: string; paths: string[]; body?: string },
  ): Promise<{ operationId: string }> {
    const statement = input.statement?.trim();
    const paths = (input.paths ?? []).map((p) => p.trim()).filter(Boolean);
    if (!statement) throw new BadRequestException('Asserção sem texto');
    if (paths.length === 0)
      throw new BadRequestException('Asserção sem paths citados');

    const project = await this.assertOwner(userId, projectId);
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { login: true },
    });

    const userToken = await this.auth.userToken(userId);
    const headSha = await this.git.getHeadSha(
      userToken,
      project.owner,
      project.name,
      project.defaultBranch,
    );

    const assertion: ContextAssertion = {
      statement,
      paths,
      author: user?.login ?? 'desconhecido',
      date: new Date().toISOString().slice(0, 10),
      sha: headSha ? headSha.slice(0, 7) : '',
      status: 'vigente',
      body: input.body?.trim() ?? '',
    };

    return this.writeContext(projectId, project, (current) => {
      if (current.some((a) => a.statement === assertion.statement)) {
        throw new BadRequestException('Já existe uma asserção com este texto');
      }
      return [...current, assertion];
    }, `docs: registra asserção de contexto (${CONTEXT_PATH})`);
  }

  /**
   * Revalidação leve (SPEC-015): confirma uma asserção `a-revalidar` — renova
   * data+sha com novo commit; volta a `vigente` no re-sync.
   */
  async revalidate(
    userId: string,
    projectId: string,
    assertionId: string,
  ): Promise<{ operationId: string }> {
    const project = await this.assertOwner(userId, projectId);
    const row = await this.prisma.assertion.findFirst({
      where: { id: assertionId, projectId },
    });
    if (!row) throw new NotFoundException('Asserção não encontrada');

    const userToken = await this.auth.userToken(userId);
    const headSha = await this.git.getHeadSha(
      userToken,
      project.owner,
      project.name,
      project.defaultBranch,
    );
    const today = new Date().toISOString().slice(0, 10);
    const shortSha = headSha ? headSha.slice(0, 7) : '';

    return this.writeContext(projectId, project, (current) => {
      const idx = current.findIndex((a) => a.statement === row.statement);
      if (idx === -1) {
        // O humano editou/removeu a seção à mão — o repo é a fonte; não recriar.
        throw new BadRequestException(
          'Asserção não está mais no CONTEXT.md — sincronize e recarregue',
        );
      }
      return current.map((a, i) =>
        i === idx
          ? { ...a, date: today, sha: shortSha, status: 'vigente' as const }
          : a,
      );
    }, `docs: revalida asserção de contexto (${CONTEXT_PATH})`);
  }

  /**
   * Ler-mesclar-reescrever + Operation + re-sync SHA-aware — o mesmo shape do
   * MappingService.putMapping. `mutate` recebe as asserções atuais do arquivo
   * (parse do Document sincronizado) e devolve a lista nova.
   */
  private async writeContext(
    projectId: string,
    project: { owner: string; name: string; defaultBranch: string },
    mutate: (current: ContextAssertion[]) => ContextAssertion[],
    message: string,
  ): Promise<{ operationId: string }> {
    const operationId = await this.activity.start(
      projectId,
      'assertion',
      CONTEXT_PATH,
    );

    try {
      const current = await this.prisma.document.findUnique({
        where: { projectId_path: { projectId, path: CONTEXT_PATH } },
        select: { content: true },
      });
      const { assertions } = parseContextMd(current?.content ?? null);
      const content = serializeContextMd(mutate(assertions));

      const token = await this.auth.installationToken(projectId);
      let newBlobSha = '';
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const baseSha = await this.writeback.getFileSha(
            token,
            project.owner,
            project.name,
            CONTEXT_PATH,
            project.defaultBranch,
          );
          newBlobSha = await this.writeback.putFile({
            token,
            owner: project.owner,
            repo: project.name,
            path: CONTEXT_PATH,
            branch: project.defaultBranch,
            content,
            message,
            baseSha,
          });
          break;
        } catch (err) {
          if (err instanceof WritebackConflictError && attempt === 0) continue;
          throw err;
        }
      }

      const commitUrl = `https://github.com/${project.owner}/${project.name}/blob/${project.defaultBranch}/${CONTEXT_PATH}`;
      await this.activity.attachArtifacts(operationId, { commitUrl });
      await this.activity.advance(operationId, 'propagate');

      // Re-sync SHA-aware: o sync espera a Trees API refletir este blob antes
      // de decidir noop (consistência eventual — ver SyncService.listScope).
      const { syncRunId } = await this.ingestion.enqueueSync(projectId, {
        path: CONTEXT_PATH,
        blobSha: newBlobSha,
      });
      await this.activity.advance(operationId, 'sync');
      await this.activity.attachArtifacts(operationId, { syncRunId });
      return { operationId };
    } catch (err) {
      await this.activity.fail(
        operationId,
        err instanceof Error ? err.message : 'Falha ao salvar o contexto',
      );
      throw err;
    }
  }

  /**
   * Ingestão no fim do sync: parseia o CONTEXT.md sincronizado (editado à mão
   * conta igual — o repo é a fonte), aplica a validade datada e reconstrói a
   * tabela (replace-all, padrão resolution.rebuild). Rebaixa a `a-revalidar`
   * quando um path citado recebeu commit depois da data; NUNCA apaga.
   */
  async rebuild(projectId: string): Promise<void> {
    const doc = await this.prisma.document.findUnique({
      where: { projectId_path: { projectId, path: CONTEXT_PATH } },
      select: { content: true },
    });
    const { assertions, warnings } = parseContextMd(doc?.content ?? null);
    for (const w of warnings) {
      this.logger.warn(`CONTEXT.md degradado (projeto ${projectId}): ${w}`);
    }

    const withStatus = await this.applyValidity(projectId, assertions);

    await this.prisma.$transaction([
      this.prisma.assertion.deleteMany({ where: { projectId } }),
      this.prisma.assertion.createMany({
        data: withStatus.map((a) => ({
          projectId,
          statement: a.statement,
          paths: a.paths,
          author: a.author,
          assertedAt: a.date,
          assertedSha: a.sha,
          status: a.status,
          body: a.body,
          contextPath: CONTEXT_PATH,
        })),
      }),
    ]);
  }

  /**
   * Validade datada via Commits API (`?path=&per_page=1` — mesma máquina do
   * ADR-010). Só re-checa asserções `vigente` (as já `a-revalidar` não pioram)
   * com cap por sync. Falha de rede tolerada: mantém o status do arquivo.
   */
  private async applyValidity(
    projectId: string,
    assertions: ContextAssertion[],
  ): Promise<ContextAssertion[]> {
    if (assertions.length === 0) return assertions;
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { userId: true, owner: true, name: true },
    });
    if (!project) return assertions;

    let token: string;
    try {
      token = await this.auth.userToken(project.userId);
    } catch {
      return assertions; // sem token não há checagem — status do arquivo vale
    }

    let checks = 0;
    const out: ContextAssertion[] = [];
    for (const a of assertions) {
      if (a.status !== 'vigente' || !a.date || a.paths.length === 0) {
        out.push(a);
        continue;
      }
      if (checks + a.paths.length > MAX_VALIDITY_CHECKS_PER_SYNC) {
        this.logger.warn(
          `Cap de validade atingido (projeto ${projectId}) — asserções restantes mantêm o status do arquivo`,
        );
        out.push(a);
        continue;
      }
      try {
        const dates = await Promise.all(
          a.paths.map((p) => {
            checks++;
            // Commits API filtra por path sem barra final (mesma regra do ADR-010).
            return this.git.getLastCommitDate(
              token,
              project.owner,
              project.name,
              p.replace(/\/$/, ''),
            );
          }),
        );
        out.push({ ...a, status: revalidationStatus(a.date, dates) });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'erro';
        this.logger.warn(
          `Checagem de validade falhou (projeto ${projectId}, "${a.statement}"): ${message}`,
        );
        out.push(a); // tolerante: mantém o status do arquivo
      }
    }
    return out;
  }
}
