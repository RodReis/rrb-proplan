import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { GithubAuth } from '../../identity/application/github-auth.service';
import { LinkService } from './link.service';
import { ResolutionService } from './resolution.service';
import { diffScope } from '../domain/diff';
import { parseFrontmatter } from '../domain/frontmatter';
import { computeScopeHash } from '../domain/scope-hash';
import { isInScope } from '../domain/scope-filter';
import { GithubGitClient } from '../infrastructure/github-git.client';
import { classifyKind } from '../domain/document-kind';
import { DeclaredProdUrl, parseProplanConfig } from '../domain/proplan-config';
import {
  DeploySignal,
  extractDeclaredPlatforms,
  platformsFromRepoConfig,
  platformFromDeclaredUrl,
  reconcile,
} from '../domain/deploy-drift';
import { platformFromProbe } from '../domain/deploy-probe';
import { ciStatusOf } from '../domain/ci-status';
import { HttpProbe } from '../infrastructure/http-probe';

/** Evento de domínio: docs de um projeto foram sincronizados com hash novo.
 *  Carrega o tenant para os jobs de IA que o listener enfileira — eles rodam
 *  fora de request e precisam abrir o contexto RLS (SPEC-022). */
export class DocsSyncedEvent {
  constructor(
    readonly projectId: string,
    readonly docsScopeHash: string,
    readonly tenantId: string,
  ) {}
}
export const DOCS_SYNCED = 'docs.synced';

/** Emitido ao fim de todo sync (sucesso E noop). O board escuta para
 *  sincronizar as issues junto — cobre mudanças feitas direto no GitHub. */
export class SyncCompletedEvent {
  constructor(readonly projectId: string) {}
}
export const SYNC_COMPLETED = 'sync.completed';

export interface SyncResult {
  status: 'success' | 'noop' | 'failed';
  added: number;
  updated: number;
  removed: number;
  skipped: number;
}

/**
 * Backoff entre re-leituras da Trees API à espera da propagação de um write-back
 * (ver SyncService.listScope). Um item por tentativa; a soma (~7,5s) cobre com
 * folga a janela típica de consistência eventual do GitHub.
 */
const TREE_PROPAGATION_BACKOFF_MS = [1000, 2000, 4500];
const TREE_PROPAGATION_RETRIES = TREE_PROPAGATION_BACKOFF_MS.length;

/** Teto de URLs de produção sondadas por sync (ADR-018 guarda 5 — rate-limit). */
const MAX_PROBED_URLS = 10;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

@Injectable()
export class SyncService {
  private readonly logger = new Logger(SyncService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auth: GithubAuth,
    private readonly git: GithubGitClient,
    private readonly events: EventEmitter2,
    private readonly links: LinkService,
    private readonly resolution: ResolutionService,
    private readonly httpProbe: HttpProbe,
  ) {}

  /**
   * Executa um sync run já existente (criado como `queued` pelo enqueue).
   * Idempotente por (projectId, docsScopeHash): hash igual → no-op auditado.
   */
  async runSync(syncRunId: string): Promise<void> {
    const run = await this.prisma.syncRun.findUnique({
      where: { id: syncRunId },
      include: { project: true },
    });
    if (!run) throw new NotFoundException('SyncRun não encontrado');
    const project = run.project;
    // NOT NULL no banco desde a migração da Fatia 8; o tipo é nullable só pelo
    // backfill (ver schema). Capturado aqui para o DocsSyncedEvent.
    const tenantId = project.tenantId;
    if (!tenantId) throw new Error('Projeto sem tenant (invariante SPEC-022)');

    await this.prisma.syncRun.update({
      where: { id: run.id },
      data: { status: 'running' },
    });

    try {
      const token = await this.auth.userToken(project.userId);
      const scope = await this.listScope(token, project, run);
      const scopeHash = computeScopeHash(scope);

      // Idempotência: hash igual ao último aplicado → no-op sem downloads.
      if (project.docsScopeHash === scopeHash) {
        await this.updateCommitMeta(project.id, token, project.owner, project.name);
        // Recomputa o grafo no noop também: docs ingeridos antes da Fatia 4
        // ainda não têm arestas; recompute é barato e idempotente.
        await this.links.rebuildLinks(project.id);
        await this.resolution.rebuild(project.id);
        await this.updateDeploySignals(
          project.id,
          token,
          project.owner,
          project.name,
          project.defaultBranch,
        );
        await this.updateCiStatus(project.id, token, project.owner, project.name);

        // Idem ao caminho `success`: as issues sincronizam ANTES do status
        // final. Aqui importa ainda mais — `noop` diz "os docs não mudaram",
        // e as **issues** podem ter mudado (é o caso de mover um card direto
        // no GitHub, que não toca `docs/`).
        await this.events.emitAsync(SYNC_COMPLETED, new SyncCompletedEvent(project.id));

        await this.finish(run.id, 'noop', scopeHash, {
          added: 0,
          updated: 0,
          removed: 0,
          skipped: 0,
        });
        return;
      }

      const localDocs = await this.prisma.document.findMany({
        where: { projectId: project.id },
        select: { path: true, blobSha: true },
      });
      const local = new Map(localDocs.map((d) => [d.path, d.blobSha]));
      const { added, updated, removed } = diffScope(scope, local);

      let skipped = 0;
      for (const entry of [...added, ...updated]) {
        const kind = classifyKind(entry.path);

        if (kind !== 'markdown') {
          // Binário: só metadado, NÃO baixa os bytes (Decisão 2). content vazio,
          // byteSize 0 — o tamanho real aparece quando o preview busca sob demanda.
          await this.prisma.document.upsert({
            where: { projectId_path: { projectId: project.id, path: entry.path } },
            create: {
              projectId: project.id,
              path: entry.path,
              blobSha: entry.blobSha,
              content: '',
              frontmatter: Prisma.JsonNull,
              isConventional: false,
              byteSize: 0,
              kind,
            },
            update: {
              blobSha: entry.blobSha,
              content: '',
              frontmatter: Prisma.JsonNull,
              isConventional: false,
              byteSize: 0,
              kind,
            },
          });
          continue;
        }

        const blob = await this.git.getBlob(
          token,
          project.owner,
          project.name,
          entry.blobSha,
        );
        if (blob === null) {
          skipped++;
          this.logger.warn(
            `Blob ${entry.path} acima de 512 KB — ignorado no projeto ${project.id}`,
          );
          continue;
        }
        const fm = parseFrontmatter(blob.content);
        // Prisma Json aceita Prisma.JsonNull para limpar; frontmatter é objeto simples.
        const frontmatter = (fm.data ?? Prisma.JsonNull) as Prisma.InputJsonValue;
        await this.prisma.document.upsert({
          where: { projectId_path: { projectId: project.id, path: entry.path } },
          create: {
            projectId: project.id,
            path: entry.path,
            blobSha: entry.blobSha,
            content: blob.content,
            frontmatter,
            isConventional: fm.isConventional,
            byteSize: blob.byteSize,
            kind: 'markdown',
          },
          update: {
            blobSha: entry.blobSha,
            content: blob.content,
            frontmatter,
            isConventional: fm.isConventional,
            byteSize: blob.byteSize,
            kind: 'markdown',
          },
        });
      }

      if (removed.length > 0) {
        await this.prisma.document.deleteMany({
          where: { projectId: project.id, path: { in: removed } },
        });
      }

      // Grafo (SPEC-004): recomputa arestas a partir do conteúdo atual dos docs.
      await this.links.rebuildLinks(project.id);
      await this.resolution.rebuild(project.id);

      await this.prisma.project.update({
        where: { id: project.id },
        data: { docsScopeHash: scopeHash, lastSyncAt: new Date() },
      });

      await this.updateCommitMeta(project.id, token, project.owner, project.name);
      await this.updateDeploySignals(
        project.id,
        token,
        project.owner,
        project.name,
        project.defaultBranch,
      );
      await this.updateCiStatus(project.id, token, project.owner, project.name);

      // Issues ANTES de marcar success: `status: success` é o sinal que o
      // cliente espera para recarregar a tela. Emitir depois criava a corrida
      // — o front lia o board enquanto o `syncIssues` ainda ia rodar, e o card
      // só aparecia certo depois de um F5. `emitAsync` espera os handlers.
      await this.events.emitAsync(SYNC_COMPLETED, new SyncCompletedEvent(project.id));

      await this.finish(run.id, 'success', scopeHash, {
        added: added.length,
        updated: updated.length,
        removed: removed.length,
        skipped,
      });

      // Fica DEPOIS de propósito: dispara os jobs de IA (assíncronos por
      // contrato, ADR-002 — nunca no caminho de uma request). Esperar por eles
      // seguraria o sync por minutos.
      this.events.emit(
        DOCS_SYNCED,
        new DocsSyncedEvent(project.id, scopeHash, tenantId),
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erro desconhecido';
      await this.prisma.syncRun.update({
        where: { id: run.id },
        data: { status: 'failed', error: message, finishedAt: new Date() },
      });
      // Relança para o BullMQ contabilizar a tentativa (retry com backoff).
      throw err;
    }
  }

  /**
   * Lê a árvore de docs (Trees API) e retorna o escopo. Quando o run carrega
   * uma expectativa de write-back (`expectPath`/`expectBlobSha` — ver
   * enqueueSync), refaz o listTree com backoff curto até a árvore refletir
   * aquele blob. A Git Trees API tem consistência eventual: por alguns segundos
   * após um commit, ela ainda serve a árvore anterior. Sem esta espera o re-sync
   * do promote lê o escopo antigo → mesmo hash → noop → o doc promovido não é
   * ingerido e o badge não some até um sync manual.
   *
   * Validar o SHA (em vez de dormir cego) é o root-cause: retorna assim que a
   * propagação de fato aconteceu, e não paga a espera quando ela já aconteceu.
   * Se estourar o teto, segue com a árvore que tem — o próximo sync natural
   * corrige, sem perda de dado.
   */
  private async listScope(
    token: string,
    project: { owner: string; name: string; defaultBranch: string; id: string },
    run: { expectPath: string | null; expectBlobSha: string | null },
  ) {
    const readScope = async () => {
      const tree = await this.git.listTree(
        token,
        project.owner,
        project.name,
        project.defaultBranch,
      );
      return tree.filter((b) => isInScope(b.path));
    };

    let scope = await readScope();
    if (!run.expectBlobSha || !run.expectPath) return scope;

    const satisfied = () =>
      scope.some(
        (b) => b.path === run.expectPath && b.blobSha === run.expectBlobSha,
      );

    for (let attempt = 0; attempt < TREE_PROPAGATION_RETRIES && !satisfied(); attempt++) {
      await sleep(TREE_PROPAGATION_BACKOFF_MS[attempt]);
      scope = await readScope();
    }

    if (!satisfied()) {
      this.logger.warn(
        `Trees API ainda não refletiu ${run.expectPath} (projeto ${project.id}) ` +
          `após ${TREE_PROPAGATION_RETRIES} tentativas — seguindo; próximo sync corrige.`,
      );
    }
    return scope;
  }

  /**
   * Coleta metadados de defasagem (ADR-010): data do último commit em `docs`
   * e do último commit do repo. Falha aqui NÃO falha o sync — os campos ficam
   * como estavam (ou nulos) e a UI apenas omite o bloco de frescor.
   */
  private async updateCommitMeta(
    projectId: string,
    token: string,
    owner: string,
    name: string,
  ): Promise<void> {
    try {
      const [lastDocsCommitAt, lastCodeCommitAt] = await Promise.all([
        this.git.getLastCommitDate(token, owner, name, 'docs'),
        this.git.getLastCommitDate(token, owner, name),
      ]);
      await this.prisma.project.update({
        where: { id: projectId },
        data: {
          lastDocsCommitAt,
          lastCodeCommitAt,
          commitMetaSyncedAt: new Date(),
        },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'erro';
      this.logger.warn(
        `Coleta de metadados de commit falhou (projeto ${projectId}): ${message}`,
      );
    }
  }

  /**
   * Drift de deploy (SPEC-013): coleta as 4 fontes (doc de deploy, config no
   * repo, GitHub Deployments, URL declarada), reconcilia e persiste veredito +
   * sinais. NUNCA coroa uma fonte como verdade — só classifica o padrão. Falha
   * aqui NÃO derruba o sync (mesma regra do updateCommitMeta): os campos ficam
   * como estavam e a UI omite a faixa. Só metadados GitHub-side, zero IA, zero
   * chamada externa ao ProPlan (a plataforma sai do domínio da URL, por texto).
   */
  private async updateDeploySignals(
    projectId: string,
    token: string,
    owner: string,
    name: string,
    branch: string,
  ): Promise<void> {
    try {
      const observedAt = new Date();
      const iso = observedAt.toISOString();
      const signals: DeploySignal[] = [];

      // Fonte 1 — doc de deploy resolvido (pode silenciar).
      const deployRes = await this.resolution.resolutionOf(projectId, 'deploy');
      const deployPaths =
        deployRes.paths.length > 0
          ? deployRes.paths
          : deployRes.path
            ? [deployRes.path]
            : [];
      if (deployPaths.length > 0) {
        const docs = await this.prisma.document.findMany({
          where: { projectId, path: { in: deployPaths } },
          select: { content: true },
        });
        const platforms = extractDeclaredPlatforms(
          docs.map((d) => d.content).join('\n'),
        );
        signals.push({
          source: 'doc',
          platforms,
          observedAt: iso,
          evidenceRef: deployPaths.join(', '),
        });
      }

      // Fonte 2 — config de deploy na raiz do repo (declaração de intenção).
      const rootFiles = await this.git.listRootFiles(token, owner, name, branch);
      const configHits = platformsFromRepoConfig(rootFiles);
      if (configHits.length > 0) {
        signals.push({
          source: 'repoConfig',
          platforms: [...new Set(configHits.map((h) => h.platform))],
          observedAt: iso,
          evidenceRef: configHits.map((h) => h.file).join(', '),
        });
      }

      // Fonte 3 — GitHub Deployments (degrada sem a permissão Deployments:read).
      const deployments = await this.git.listDeploymentUrls(token, owner, name);
      if (!deployments.denied && deployments.count > 0) {
        const platforms = [
          ...new Set(
            deployments.environmentUrls
              .map((u) => platformFromDeclaredUrl(u))
              .filter((p): p is string => p !== null),
          ),
        ];
        signals.push({
          source: 'githubDeployments',
          platforms,
          observedAt: iso,
          evidenceRef: `${deployments.count} deployment(s)`,
        });
      }

      // Fonte 4 — URL de produção declarada pelo dono (.proplan/config.yml).
      // SPEC-013.6: cada URL vira um sinal com seu modo (string/probe/bloqueada).
      const configDoc = await this.prisma.document.findFirst({
        where: { projectId, path: '.proplan/config.yml' },
        select: { content: true },
      });
      const { config } = parseProplanConfig(configDoc?.content ?? null);
      const allUrls = config?.deployProdUrls ?? [];
      // Guarda 5 do ADR-018 (rate-limit por sync): teto de URLs sondadas. Um
      // config.yml com centenas de prodUrls não vira centenas de probes.
      const prodUrls = allUrls.slice(0, MAX_PROBED_URLS);
      if (allUrls.length > MAX_PROBED_URLS) {
        this.logger.warn(
          `Projeto ${projectId}: ${allUrls.length} prodUrls declaradas; sondando só as ${MAX_PROBED_URLS} primeiras (ADR-018).`,
        );
      }
      for (const u of prodUrls) {
        signals.push(await this.probeDeclaredUrl(u, iso));
      }

      const verdict = reconcile(signals);
      await this.prisma.project.update({
        where: { id: projectId },
        data: {
          deployVerdict: verdict.state,
          deploySignals: verdict.signals as unknown as Prisma.InputJsonValue,
          deployObservedAt: observedAt,
        },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'erro';
      this.logger.warn(
        `Coleta de drift de deploy falhou (projeto ${projectId}): ${message}`,
      );
    }
  }

  /**
   * CI (SPEC-019): coleta o último workflow run (Actions API) e persiste o
   * status derivado + URL + data como cache no Project. Tolerante a falha (mesma
   * regra do updateDeploySignals): falhar aqui NÃO derruba o sync — os campos
   * ficam como estavam e o portfólio omite/neutraliza o sinal. Só metadados
   * GitHub-side, zero IA. Repo sem Actions → `sem-ci` (não erro).
   */
  private async updateCiStatus(
    projectId: string,
    token: string,
    owner: string,
    name: string,
  ): Promise<void> {
    try {
      const run = await this.git.listLatestWorkflowRun(token, owner, name);
      const status = ciStatusOf(run);
      await this.prisma.project.update({
        where: { id: projectId },
        data: {
          ciStatus: status,
          ciConclusionUrl: run.url,
          ciObservedAt: new Date(),
        },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'erro';
      this.logger.warn(
        `Coleta de CI falhou (projeto ${projectId}): ${message}`,
      );
    }
  }

  /**
   * SPEC-013.6: obtém a plataforma de UMA URL declarada, com o modo usado.
   *  - `platform` declarada à mão pelo dono → usa, sem probe (mode string).
   *  - probe bloqueado por segurança (destino não-público) → sinal
   *    `bloqueada_por_seguranca`, transparente, platforms vazio.
   *  - probe respondeu com fingerprint → mode probe.
   *  - probe falhou/sem fingerprint → cai no parse de domínio (mode string,
   *    decisão do PI: probe falho ≠ inseguro; domínio próprio → desconhecida).
   */
  private async probeDeclaredUrl(
    u: DeclaredProdUrl,
    iso: string,
  ): Promise<DeploySignal> {
    const base = { source: 'declaredUrl' as const, observedAt: iso, evidenceRef: u.url };

    // Plataforma declarada à mão vence (domínio próprio resolvido pelo dono).
    if (u.platform) {
      return { ...base, platforms: [u.platform], mode: 'string' };
    }

    const result = await this.httpProbe.probe(u.url);
    if (result.blocked) {
      if (result.reason === 'destino_nao_publico') {
        return { ...base, platforms: [], mode: 'bloqueada_por_seguranca' };
      }
      // Timeout/DNS/http/etc — não é bloqueio de segurança: cai no parse de domínio.
      const fromDomain = platformFromDeclaredUrl(u.url);
      return { ...base, platforms: fromDomain ? [fromDomain] : [], mode: 'string' };
    }

    const fromProbe = platformFromProbe(result.headers, result.finalUrl, result.bodySlice);
    if (fromProbe) return { ...base, platforms: [fromProbe], mode: 'probe' };

    // Probe respondeu mas sem fingerprint reconhecido → parse de domínio.
    const fromDomain = platformFromDeclaredUrl(u.url);
    return { ...base, platforms: fromDomain ? [fromDomain] : [], mode: 'string' };
  }

  private async finish(
    runId: string,
    status: 'success' | 'noop',
    docsScopeHash: string,
    counts: { added: number; updated: number; removed: number; skipped: number },
  ): Promise<void> {
    await this.prisma.syncRun.update({
      where: { id: runId },
      data: { status, docsScopeHash, ...counts, finishedAt: new Date() },
    });
  }
}
