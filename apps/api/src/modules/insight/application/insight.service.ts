import { ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InsightKind, InsightRunOutcome, Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { SettingsService } from '../../settings/application/settings.service';
import { IngestionService } from '../../ingestion/application/ingestion.service';
import { ResolutionService } from '../../ingestion/application/resolution.service';
import { Entity, ENTITIES } from '../../ingestion/domain/entity';
import { LlmUsageRecorder } from './llm-usage.recorder';
import { UsageService } from './usage.service';
import { selectContext } from '../domain/context-budget';
import { buildSummaryUser, SUMMARY_SYSTEM } from '../domain/summary-prompt';
import { parseSummary, StateSummary } from '../domain/summary';
import {
  buildCardsUser,
  CARDS_SYSTEM,
  CardProposal,
  parseCards,
} from '../domain/cards-prompt';
import { buildEdgesUser, EDGES_SYSTEM, InferredEdge, parseEdges } from '../domain/edges-prompt';
import {
  buildClassifyUser,
  CLASSIFIABLE_ENTITIES,
  CLASSIFY_SYSTEM,
  ClassifyHit,
  parseClassify,
} from '../domain/classify-prompt';
import { summarizeDoc } from '../domain/summarize-doc';
import { buildFallbackUser, FALLBACK_SYSTEM } from '../domain/fallback-prompt';
import { computeInputHash } from '../domain/input-hash';
import { LlmClientFactory } from '../infrastructure/llm-client.factory';
import { LlmRequest } from '../domain/llm-client';

/** Entidades com fallback inferido quando ausentes (eixo C, Fatia 7). */
type FallbackEntity = 'architecture' | 'design';

/** Kinds de insight regeneráveis pelo botão "Regenerar" (força IA — SPEC-011). */
const REGENERABLE_KINDS = [
  'summary',
  'edges',
  'classify',
  'architecture_fallback',
  'design_fallback',
] as const;
export type RegenerableKind = (typeof REGENERABLE_KINDS)[number];

/** Teto de tokens de entrada por resumo (cap de custo — SPEC-003). */
const MAX_INPUT_TOKENS = 12_000;
const MAX_OUTPUT_TOKENS = 1024;
const MAX_EDGES_OUTPUT_TOKENS = 2048;
const MAX_CLASSIFY_OUTPUT_TOKENS = 2048;
const MAX_FALLBACK_OUTPUT_TOKENS = 2048;
/** Confidence fixa para classificação nível 3 — o prompt não pede score numérico. */
const CLASSIFY_CONFIDENCE = 0.7;

@Injectable()
export class InsightService {
  private readonly logger = new Logger(InsightService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly llmFactory: LlmClientFactory,
    private readonly ingestion: IngestionService,
    private readonly resolution: ResolutionService,
    private readonly usage: LlmUsageRecorder,
    private readonly usageGate: UsageService,
  ) {}

  // ── Gate por inputHash (SPEC-011, emenda ao ADR-002) ─────────────────────
  //
  // Cada gerador monta o prompt, calcula o `inputHash` (SHA-256 de
  // system+user+provider+model) e consulta o Insight de mesmo
  // (projectId, kind, inputHash). HIT ⇒ não chama o provedor (registra `reused`
  // em InsightRun, não toca LlmUsage — cache-hit não é gasto, ADR-016). MISS ⇒
  // chama, grava o artefato com os dois hashes e registra `generated`.
  //
  // O gate substitui a idempotência antiga por `docsScopeHash` (os 4 `where`).
  // Segurança dos efeitos colaterais em cache-hit: as arestas inferidas
  // (`DocLink kind:inferred`) e a resolução nível 3 (`source:inference`) NÃO são
  // apagadas pelo rebuild determinístico do sync (link.service preserva
  // inferred; resolution.rebuild preserva inference enquanto o doc existir).
  // Portanto pular o write ao ingestion num hit é correto — o efeito já persiste.

  /** Busca o Insight cacheado para este input exato (ou null). */
  private async findCached(projectId: string, kind: InsightKind, inputHash: string) {
    return this.prisma.insight.findFirst({
      where: { projectId, kind, inputHash },
      orderBy: { createdAt: 'desc' },
    });
  }

  /** Registra a execução do job de insight (append-only — SPEC-011, Decisão 1). */
  private async recordRun(
    projectId: string,
    kind: InsightKind,
    outcome: InsightRunOutcome,
    inputHash: string,
  ): Promise<void> {
    await this.prisma.insightRun.create({
      data: { projectId, kind, outcome, inputHash },
    });
  }

  /**
   * Gera (ou regenera) o resumo de estado de um projeto e persiste como
   * Insight chaveado por `inputHash` (SPEC-011). HIT ⇒ reaproveita sem chamar a
   * IA. Só o `summary` regenera a cada entrega — `ondeParou` é literalmente a
   * última coisa concluída (decisão do PI).
   */
  async generateSummary(
    projectId: string,
    opts: { force?: boolean } = {},
  ): Promise<void> {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
    });
    if (!project) throw new NotFoundException('Projeto não encontrado');
    const docsScopeHash = project.docsScopeHash;
    if (!docsScopeHash) {
      this.logger.warn(`Projeto ${projectId} sem sync — resumo ignorado`);
      return;
    }

    const docs = await this.prisma.document.findMany({
      where: { projectId },
      select: { path: true, content: true },
    });
    if (docs.length === 0) return;

    const context = selectContext(docs, MAX_INPUT_TOKENS);
    const provider = await this.settings.providerOf(project.userId);
    const client = this.llmFactory.create(provider);
    const req: LlmRequest = {
      system: SUMMARY_SYSTEM,
      user: buildSummaryUser(context),
      maxTokens: MAX_OUTPUT_TOKENS,
    };
    const inputHash = computeInputHash({
      system: req.system,
      user: req.user,
      provider: client.provider,
      model: client.model,
    });

    if (!opts.force) {
      const cached = await this.findCached(projectId, 'summary', inputHash);
      if (cached) {
        await this.recordRun(projectId, 'summary', 'reused', inputHash);
        return; // input idêntico → nada novo a aprender (SPEC-011)
      }
    }

    const summary = await this.completeSummary(project.id, client, req);
    const content: StateSummary = {
      oQueE: summary.oQueE,
      ondeParou: summary.ondeParou,
      oQueFalta: summary.oQueFalta,
    };

    await this.prisma.insight.create({
      data: {
        projectId,
        kind: 'summary',
        docsScopeHash,
        inputHash,
        provider: client.provider,
        model: summary.model,
        inputTokens: summary.inputTokens,
        outputTokens: summary.outputTokens,
        content: content as unknown as Prisma.InputJsonValue,
      },
    });
    await this.recordRun(projectId, 'summary', 'generated', inputHash);
  }

  /** Resumo mais recente do projeto (leitura para a Visão Geral). */
  async latestSummary(userId: string, projectId: string) {
    await this.assertOwner(userId, projectId);
    return this.prisma.insight.findFirst({
      where: { projectId, kind: 'summary' },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Regenera uma inferência forçando a chamada de IA (ignora o `inputHash`),
   * protegido pelo teto de gasto (SPEC-009/ADR-016). É o único caminho para
   * reaplicar um provedor novo sobre um input inalterado (ADR-008) — ex.: a
   * tabela de preços mudou, ou o modelo melhorou (SPEC-011, item 5).
   */
  async regenerate(userId: string, projectId: string, kind: RegenerableKind): Promise<void> {
    await this.assertOwner(userId, projectId);
    await this.assertUnderCap(userId);
    switch (kind) {
      case 'summary':
        return this.generateSummary(projectId, { force: true });
      case 'edges':
        return this.generateEdges(projectId, { force: true });
      case 'classify':
        return this.classifyAbsent(projectId, { force: true });
      case 'architecture_fallback':
        return this.generateFallback(projectId, 'architecture', { force: true });
      case 'design_fallback':
        return this.generateFallback(projectId, 'design', { force: true });
    }
  }

  /** Barra a ação se o teto de gasto de IA do mês foi atingido (SPEC-009). */
  private async assertUnderCap(userId: string): Promise<void> {
    if (!(await this.usageGate.canSpendForUser(userId))) {
      throw new ForbiddenException(
        'Teto de gasto de IA atingido neste mês — ajuste em Configurações → Uso de IA',
      );
    }
  }

  /**
   * Propõe um backlog inicial de cards a partir da documentação (SPEC-005,
   * bootstrap do Kanban). Interface pública consumida pelo board — o board
   * não sabe de LLM, só pede a proposta; a criação de issues é dele. 1 retry
   * em JSON inválido. Fica FORA do gate por inputHash: é ação manual, sempre
   * intencional (o usuário clicou), e o teto já a protege.
   */
  async proposeCards(userId: string, projectId: string): Promise<CardProposal[]> {
    await this.assertOwner(userId, projectId);
    await this.assertUnderCap(userId); // bootstrap por IA respeita o teto (SPEC-009)
    const project = await this.prisma.project.findUnique({ where: { id: projectId } });
    if (!project) throw new NotFoundException('Projeto não encontrado');

    const docs = await this.prisma.document.findMany({
      where: { projectId },
      select: { path: true, content: true },
    });
    if (docs.length === 0) {
      throw new NotFoundException('Projeto sem documentação para propor cards');
    }

    const context = selectContext(docs, MAX_INPUT_TOKENS);
    const client = this.llmFactory.create(await this.settings.providerOf(project.userId));
    const req = { system: CARDS_SYSTEM, user: buildCardsUser(context), maxTokens: 2048 };

    // runParsed grava uma linha por tentativa: parse inválido → discarded,
    // parse ok → ok (SPEC-009). O ledger não derruba a chamada.
    return this.usage.runParsed(client, req, { projectId, kind: 'status_bootstrap' }, parseCards);
  }

  /**
   * Gera arestas semânticas entre documentos via IA e ENTREGA ao ingestion —
   * insight nunca escreve no store (ADR-001). Idempotente por `inputHash`
   * (SPEC-011): input idêntico ⇒ HIT ⇒ não chama a IA e não reescreve as
   * arestas (o rebuild do sync preserva as inferidas). Chamado só pelo worker
   * (ADR-002 — IA nunca no caminho de render).
   */
  async generateEdges(projectId: string, opts: { force?: boolean } = {}): Promise<void> {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
    });
    if (!project?.docsScopeHash) return;
    const docsScopeHash = project.docsScopeHash;

    const docs = await this.prisma.document.findMany({
      where: { projectId },
      select: { path: true, content: true },
    });
    if (docs.length < 2) return;

    const context = selectContext(docs, MAX_INPUT_TOKENS);
    const excerptByPath = new Map(context.map((d) => [d.path, d.content]));
    const docMeta = context.map((d) => ({
      path: d.path,
      ...summarizeDoc(excerptByPath.get(d.path) ?? ''),
    }));

    const explicit = await this.prisma.docLink.findMany({
      where: { projectId, kind: 'explicit' },
      select: { source: { select: { path: true } }, targetPath: true },
    });
    const explicitPairs = explicit.map((l) => ({
      source: l.source.path,
      target: l.targetPath,
    }));

    const provider = await this.settings.providerOf(project.userId);
    const client = this.llmFactory.create(provider);
    const req: LlmRequest = {
      system: EDGES_SYSTEM,
      user: buildEdgesUser(docMeta, explicitPairs),
      maxTokens: MAX_EDGES_OUTPUT_TOKENS,
    };
    const inputHash = computeInputHash({
      system: req.system,
      user: req.user,
      provider: client.provider,
      model: client.model,
    });

    if (!opts.force) {
      const cached = await this.findCached(projectId, 'edges_marker', inputHash);
      if (cached) {
        await this.recordRun(projectId, 'edges_marker', 'reused', inputHash);
        return; // arestas já no store (o rebuild não apaga inferidas) — SPEC-011
      }
    }

    const edges = await this.usage.runParsed(
      client,
      req,
      { projectId, kind: 'edges_marker' },
      parseEdges,
    );

    await this.ingestion.writeInferredEdges(projectId, edges);

    await this.prisma.insight.create({
      data: {
        projectId,
        kind: 'edges_marker',
        docsScopeHash,
        inputHash,
        provider: client.provider,
        model: 'edges',
        inputTokens: 0,
        outputTokens: 0,
        // Guarda a contagem — as arestas em si vão para o ingestion (ADR-001);
        // o marker registra quantas, para o painel de Atividade mostrar o resultado.
        content: { count: edges.length } as unknown as Prisma.InputJsonValue,
      },
    });
    await this.recordRun(projectId, 'edges_marker', 'generated', inputHash);
  }

  /**
   * Classifica documentos livres contra entidades ausentes (nível 3 da escada
   * ADR-014). Para cada entidade ausente (exceto deploy — CONVENTION.md), pergunta
   * à IA se algum doc livre É essa entidade pelo conteúdo, com spans obrigatórios
   * (ADR-012). Entrega a resolução ao ResolutionService — insight nunca escreve em
   * documentResolution direto (ADR-001). Idempotente por `inputHash` (SPEC-011):
   * HIT ⇒ não chama a IA e não reescreve a resolução (o rebuild do sync preserva
   * a inference nível 3). Chamado só pelo worker (ADR-002).
   */
  async classifyAbsent(projectId: string, opts: { force?: boolean } = {}): Promise<void> {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
    });
    if (!project?.docsScopeHash) return;
    const docsScopeHash = project.docsScopeHash;

    const resolutions = await Promise.all(
      ENTITIES.filter((e) => e !== 'deploy').map((e) => this.resolution.resolutionOf(projectId, e)),
    );
    const absentEntities = resolutions
      .filter((r) => r.source === 'absent')
      .map((r) => r.entity);
    if (absentEntities.length === 0) return; // nada a classificar

    const resolvedPaths = new Set(
      resolutions
        .filter((r) => r.source !== 'absent')
        .flatMap((r) => (r.path ? [r.path] : r.paths)),
    );

    const docs = await this.prisma.document.findMany({
      where: { projectId },
      select: { path: true, content: true },
    });
    const freeDocs = docs.filter((d) => !resolvedPaths.has(d.path));
    if (freeDocs.length === 0) return; // sem doc livre → nada a inferir

    const context = selectContext(freeDocs, MAX_INPUT_TOKENS);
    const excerptByPath = new Map(context.map((d) => [d.path, d.content]));
    const docMeta = context.map((d) => ({
      path: d.path,
      ...summarizeDoc(excerptByPath.get(d.path) ?? ''),
    }));

    const provider = await this.settings.providerOf(project.userId);
    const client = this.llmFactory.create(provider);
    const req: LlmRequest = {
      system: CLASSIFY_SYSTEM,
      user: buildClassifyUser(
        docMeta,
        absentEntities as (typeof CLASSIFIABLE_ENTITIES)[number][],
      ),
      maxTokens: MAX_CLASSIFY_OUTPUT_TOKENS,
    };
    const inputHash = computeInputHash({
      system: req.system,
      user: req.user,
      provider: client.provider,
      model: client.model,
    });

    if (!opts.force) {
      const cached = await this.findCached(projectId, 'classify_marker', inputHash);
      if (cached) {
        await this.recordRun(projectId, 'classify_marker', 'reused', inputHash);
        return; // resolução nível 3 já preservada pelo rebuild — SPEC-011
      }
    }

    const hits = await this.usage.runParsed(
      client,
      req,
      { projectId, kind: 'classify_marker' },
      parseClassify,
    );

    for (const hit of hits) {
      await this.resolution.writeInferredResolution(
        projectId,
        hit.entity,
        hit.path,
        CLASSIFY_CONFIDENCE,
      );
    }

    await this.prisma.insight.create({
      data: {
        projectId,
        kind: 'classify_marker',
        docsScopeHash,
        inputHash,
        provider: client.provider,
        model: 'classify',
        inputTokens: 0,
        outputTokens: 0,
        content: { hits } as unknown as Prisma.InputJsonValue,
      },
    });
    await this.recordRun(projectId, 'classify_marker', 'generated', inputHash);
  }

  /**
   * Spans do classify_marker mais recente do projeto que justificam a
   * classificação nível 3 de `entity` (ADR-012 — inferência sempre com
   * evidência citável). Lido pelo board via interface pública (ADR-001 — o
   * board nunca acessa `prisma.insight` direto). `[]` se não houver marker
   * ou nenhum hit bater a entidade.
   */
  async latestClassifySpans(projectId: string, entity: Entity): Promise<string[]> {
    const marker = await this.prisma.insight.findFirst({
      where: { projectId, kind: 'classify_marker' },
      orderBy: { createdAt: 'desc' },
    });
    if (!marker) return [];
    const hits = (marker.content as unknown as { hits?: ClassifyHit[] })?.hits ?? [];
    return hits.find((h) => h.entity === entity)?.spans ?? [];
  }

  /**
   * Gera uma visão markdown inferida de Arquitetura ou Design quando o
   * projeto genuinamente não tem esse documento (nem convenção/alias/config,
   * nem classificação nível 3 achou um doc — ver ResolutionService.resolutionOf).
   * Markdown livre, sem parse estrito: o texto do LLM é o próprio conteúdo
   * persistido. Idempotente por `inputHash` (SPEC-011), um hash por sub-chamada
   * (architecture e design são chaves distintas). Chamado só pelo worker (ADR-002).
   */
  async generateFallback(
    projectId: string,
    entity: FallbackEntity,
    opts: { force?: boolean } = {},
  ): Promise<void> {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
    });
    if (!project?.docsScopeHash) return;
    const docsScopeHash = project.docsScopeHash;
    const kind = `${entity}_fallback` as InsightKind;

    const r = await this.resolution.resolutionOf(projectId, entity);
    if (r.source !== 'absent') return; // já tem doc real ou já inferida (nível 3)

    const docs = await this.prisma.document.findMany({
      where: { projectId },
      select: { path: true, content: true },
    });
    if (docs.length === 0) return;

    const context = selectContext(docs, MAX_INPUT_TOKENS);
    const provider = await this.settings.providerOf(project.userId);
    const client = this.llmFactory.create(provider);
    const req: LlmRequest = {
      system: FALLBACK_SYSTEM,
      user: buildFallbackUser(context, entity),
      maxTokens: MAX_FALLBACK_OUTPUT_TOKENS,
    };
    const inputHash = computeInputHash({
      system: req.system,
      user: req.user,
      provider: client.provider,
      model: client.model,
    });

    if (!opts.force) {
      const cached = await this.findCached(projectId, kind, inputHash);
      if (cached) {
        await this.recordRun(projectId, kind, 'reused', inputHash);
        return; // markdown inferido já persistido para este input — SPEC-011
      }
    }

    let res;
    try {
      res = await this.usage.run(client, req, { projectId, kind, attempt: 1 });
    } catch (err) {
      this.logger.warn(`Fallback de ${entity} falhou (tentativa 1): ${err instanceof Error ? err.message : err}`);
      // 1 retry só em erro de chamada (não há parse) — linha própria com attempt 2.
      res = await this.usage.run(client, req, { projectId, kind, attempt: 2 });
    }

    await this.prisma.insight.create({
      data: {
        projectId,
        kind,
        docsScopeHash,
        inputHash,
        provider: client.provider,
        model: res.model,
        inputTokens: res.inputTokens,
        outputTokens: res.outputTokens,
        content: { markdown: res.text } as unknown as Prisma.InputJsonValue,
      },
    });
    await this.recordRun(projectId, kind, 'generated', inputHash);
  }

  /** Fallback inferido mais recente de `entity` no projeto (ou null). Consumido pelo board. */
  async latestFallback(userId: string, projectId: string, entity: FallbackEntity) {
    await this.assertOwner(userId, projectId);
    return this.latestFallbackInternal(projectId, entity);
  }

  /**
   * Mesma consulta de `latestFallback`, sem owner-check. Uso interno por
   * chamadores que já validaram o dono do projeto (ex.: TabsController via
   * TabsService.assertOwner) — evita duplicar a checagem de ownership.
   */
  async latestFallbackInternal(projectId: string, entity: FallbackEntity) {
    return this.prisma.insight.findFirst({
      where: { projectId, kind: `${entity}_fallback` as InsightKind },
      orderBy: { createdAt: 'desc' },
    });
  }

  /** Chama o LLM e valida o JSON do resumo; 1 retry em JSON inválido (SPEC-003). */
  private async completeSummary(
    projectId: string,
    client: ReturnType<LlmClientFactory['create']>,
    req: LlmRequest,
  ): Promise<StateSummary & { model: string; inputTokens: number; outputTokens: number }> {
    return this.usage.runParsed(client, req, { projectId, kind: 'summary' }, (text, res) => {
      const parsed = parseSummary(text);
      return {
        ...parsed,
        model: res.model,
        inputTokens: res.inputTokens,
        outputTokens: res.outputTokens,
      };
    });
  }

  private async assertOwner(userId: string, projectId: string): Promise<void> {
    const p = await this.prisma.project.findFirst({
      where: { id: projectId, userId },
      select: { id: true },
    });
    if (!p) throw new NotFoundException('Projeto não encontrado');
  }
}
