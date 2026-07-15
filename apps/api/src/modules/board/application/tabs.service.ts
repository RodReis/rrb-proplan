import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { GithubAuth } from '../../identity/application/github-auth.service';
import {
  GithubWritebackClient,
  WritebackConflictError,
} from '../../../shared/github/github-writeback.client';
import { IngestionService } from '../../ingestion/application/ingestion.service';
import { ResolutionService } from '../../ingestion/application/resolution.service';
import { Entity, Resolution } from '../../ingestion/domain/entity';
import { InsightService } from '../../insight/application/insight.service';
import { ActivityService } from '../../activity/application/activity.service';
import { parseDecisions } from '../domain/decisions-index';
import { parseDeploy } from '../domain/deploy-doc';
import { parseSkills } from '../domain/skills-index';
import { parseWorkflow, WorkflowInfo } from '../domain/workflow-parser';

/** Entidades com fallback inferido — as únicas promovíveis a doc real (Task 10/11). */
type FallbackEntity = 'architecture' | 'design';
const FALLBACK_DOC_PATH: Record<FallbackEntity, string> = {
  architecture: 'docs/ARCHITECTURE.md',
  design: 'docs/DESIGN.md',
};

export interface TabSource {
  level: 1 | 2 | 3 | 4;
  source: Resolution['source'];
  path: string | null;
  paths: string[];
  confidence: number;
}
export interface TabResponse {
  source: TabSource;
  payload: unknown | null;
}

@Injectable()
export class TabsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ingestion: ResolutionService,
    private readonly insight: InsightService,
    private readonly auth: GithubAuth,
    private readonly writeback: GithubWritebackClient,
    private readonly sync: IngestionService,
    private readonly activity: ActivityService,
  ) {}

  /** Ownership: mesmo padrão do BoardService — findFirst por id+userId. */
  async assertOwner(userId: string, projectId: string) {
    const project = await this.prisma.project.findFirst({
      where: { id: projectId, userId },
    });
    if (!project) throw new NotFoundException('Projeto não encontrado');
    return project;
  }

  async getTab(projectId: string, tab: Entity): Promise<TabResponse> {
    const r = await this.ingestion.resolutionOf(projectId, tab);
    const source: TabSource = {
      level: r.level, source: r.source, path: r.path, paths: r.paths, confidence: r.confidence,
    };
    if (r.level === 4) {
      if (tab === 'testing') {
        const ci = await this.ciFallback(projectId);
        if (ci.workflows.length > 0) return { source, payload: { ci, inferred: true } };
      }
      if (tab === 'architecture' || tab === 'design') {
        const fallback = await this.insight.latestFallbackInternal(projectId, tab);
        const markdown = (fallback?.content as { markdown?: string } | undefined)?.markdown;
        if (markdown) return { source, payload: { markdown, inferred: true } };
      }
      // SPEC-013: deploy ausente (nível 4) ainda pode ter drift a mostrar —
      // `omissa`/`so_github_side` são justamente "sem doc de deploy". Sem este
      // ramo o DriftBanner sumiria no caso mais importante.
      if (tab === 'deploy') {
        const drift = await this.deployDrift(projectId);
        if (drift.deployVerdict) return { source, payload: { environments: [], markdown: null, path: null, ...drift } };
      }
      return { source, payload: null };
    }

    // Nível 3 (inference, ADR-014): anexa aviso + spans que justificam a
    // classificação da IA (ADR-012). Board nunca lê prisma.insight direto
    // (ADR-001) — passa pela interface pública do InsightService.
    const inference = r.source === 'inference'
      ? { inferred: true as const, spans: await this.insight.latestClassifySpans(projectId, tab) }
      : null;

    switch (tab) {
      case 'architecture':
      case 'design':
        return { source, payload: { markdown: await this.markdownOf(projectId, r.path), ...inference } };
      case 'decisions': {
        const docs = await this.docsOf(projectId, r.path ? [r.path] : r.paths);
        return { source, payload: { items: parseDecisions(docs), ...inference } };
      }
      case 'deploy': {
        // SPEC-012: o documento mapeado SEMPRE aparece (ADR-014). O painel de
        // ambientes (parseDeploy) é enriquecimento de quem segue a convenção do
        // CONVENTION.md, nunca pedágio de quem não segue. parseDeploy NÃO mudou.
        // Coleção suportada (decisão do PI): concatena os N docs de `paths`.
        const { markdown, path } = await this.deployDoc(projectId, r);
        const drift = await this.deployDrift(projectId);
        return {
          source,
          payload: {
            environments: parseDeploy(markdown),
            markdown: markdown || null,
            path,
            ...drift,
            ...inference,
          },
        };
      }
      case 'skills': {
        const docs = await this.docsOf(projectId, r.paths.length ? r.paths : r.path ? [r.path] : []);
        return { source, payload: { ...parseSkills(docs), ...inference } };
      }
      case 'testing':
        return { source, payload: { markdown: await this.markdownOf(projectId, r.path), ...inference } };
      default:
        return { source, payload: null };
    }
  }

  /**
   * Promove o fallback inferido (revisado pelo usuário) a documento real do
   * repo: commita `content` em docs/ARCHITECTURE.md ou docs/DESIGN.md
   * (installation token, ADR-015) e dispara re-sync — no próximo sync a
   * entidade deixa de ser "absent" e o fallback para de ser servido.
   * Write-back segue exatamente o padrão do MappingService.putMapping.
   *
   * Retorna `{ operationId }` (SPEC-010): a operação amarra os passos nomeados
   * (commit → propagação → sync → pronto). O passo final se conclui sozinho
   * quando o SyncRun termina (ver ActivityService.get). O front faz polling.
   */
  async promote(
    userId: string,
    projectId: string,
    tab: Entity,
    content: string,
  ): Promise<{ operationId: string }> {
    if (tab !== 'architecture' && tab !== 'design') {
      throw new BadRequestException(`Aba sem fallback promovível: ${tab}`);
    }
    const project = await this.assertOwner(userId, projectId);
    const path = FALLBACK_DOC_PATH[tab];
    const operationId = await this.activity.start(projectId, 'promote', path);

    try {
      const token = await this.auth.installationToken(projectId);
      let newBlobSha = '';
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const baseSha = await this.writeback.getFileSha(
            token,
            project.owner,
            project.name,
            path,
            project.defaultBranch,
          );
          newBlobSha = await this.writeback.putFile({
            token,
            owner: project.owner,
            repo: project.name,
            path,
            branch: project.defaultBranch,
            content,
            message: `docs: promove ${tab} inferido a documento (${path})`,
            baseSha,
          });
          break;
        } catch (err) {
          if (err instanceof WritebackConflictError && attempt === 0) continue;
          throw err;
        }
      }

      const commitUrl = `https://github.com/${project.owner}/${project.name}/blob/${project.defaultBranch}/${path}`;
      await this.activity.attachArtifacts(operationId, { commitUrl });
      await this.activity.advance(operationId, 'propagate');

      // O re-sync espera a Trees API refletir este commit antes de decidir noop
      // (consistência eventual — ver SyncService.listScope). Sem isso, o listTree
      // imediato leria o escopo antigo → mesmo hash → noop → o doc promovido não
      // seria ingerido e o badge não sumiria até um sync manual.
      const { syncRunId } = await this.sync.enqueueSync(projectId, {
        path,
        blobSha: newBlobSha,
      });
      await this.activity.advance(operationId, 'sync');
      await this.activity.attachArtifacts(operationId, { syncRunId });
      // A operação conclui sozinha quando este SyncRun terminar (get deriva).
      return { operationId };
    } catch (err) {
      await this.activity.fail(
        operationId,
        err instanceof Error ? err.message : 'Falha ao promover',
      );
      throw err;
    }
  }

  /**
   * SPEC-013: veredito de drift de deploy já persistido pelo sync. Só lê o cache
   * (nunca recomputa no render — nada de chamada externa numa request, ADR-002).
   */
  private async deployDrift(projectId: string) {
    const drift = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { deployVerdict: true, deploySignals: true, deployObservedAt: true },
    });
    return {
      deployVerdict: drift?.deployVerdict ?? null,
      deploySignals: drift?.deploySignals ?? null,
      deployObservedAt: drift?.deployObservedAt ?? null,
    };
  }

  private async markdownOf(projectId: string, path: string | null): Promise<string> {
    if (!path) return '';
    const doc = await this.prisma.document.findUnique({
      where: { projectId_path: { projectId, path } },
      select: { content: true },
    });
    if (!doc) throw new NotFoundException(`Documento não encontrado: ${path}`);
    return doc.content;
  }

  /**
   * Markdown do doc de Deploy mapeado (SPEC-012). Arquivo único → o conteúdo.
   * Coleção (`path` null, `paths` não vazio) → os N docs concatenados, cada um
   * sob um heading com o seu path (mantém Mermaid e leitura por arquivo). Devolve
   * o path exibível (`path` do único, ou os paths juntos para a coleção).
   */
  private async deployDoc(
    projectId: string,
    r: { path: string | null; paths: string[] },
  ): Promise<{ markdown: string; path: string | null }> {
    if (r.path) {
      return { markdown: await this.markdownOf(projectId, r.path), path: r.path };
    }
    if (r.paths.length === 0) return { markdown: '', path: null };
    const docs = await this.docsOf(projectId, r.paths);
    // Ordena pela ordem de `paths` (docsOf não garante ordem do `in`) e mantém
    // path+conteúdo juntos — filtrar antes do map desalinharia os índices.
    const byPath = new Map(docs.map((d) => [d.path, d.content]));
    const markdown = r.paths
      .filter((p) => byPath.has(p))
      .map((p) => `## ${p}\n\n${byPath.get(p)}`)
      .join('\n\n---\n\n');
    return { markdown, path: r.paths.join(', ') };
  }

  private async docsOf(projectId: string, paths: string[]): Promise<{ path: string; content: string }[]> {
    if (paths.length === 0) return [];
    const rows = await this.prisma.document.findMany({
      where: { projectId, path: { in: paths } },
      select: { path: true, content: true },
    });
    return rows;
  }

  private async ciFallback(projectId: string): Promise<{ workflows: WorkflowInfo[] }> {
    const rows = await this.prisma.document.findMany({
      where: { projectId, path: { startsWith: '.github/workflows/' } },
      select: { path: true, content: true },
    });
    const workflows = rows
      .map((d) => parseWorkflow(d.path, d.content))
      .filter((w): w is WorkflowInfo => w !== null);
    return { workflows };
  }
}
