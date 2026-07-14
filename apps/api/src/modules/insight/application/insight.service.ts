import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InsightKind, Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { SettingsService } from '../../settings/application/settings.service';
import { IngestionService } from '../../ingestion/application/ingestion.service';
import { ResolutionService } from '../../ingestion/application/resolution.service';
import { Entity, ENTITIES } from '../../ingestion/domain/entity';
import { LlmUsageRecorder } from './llm-usage.recorder';
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
import { LlmClientFactory } from '../infrastructure/llm-client.factory';

/** Entidades com fallback inferido quando ausentes (eixo C, Fatia 7). */
type FallbackEntity = 'architecture' | 'design';

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
  ) {}

  /**
   * Gera (ou regenera) o resumo de estado de um projeto e persiste como
   * Insight versionado por docsTreeSha (ADR-002). Idempotente por hash:
   * se já existe resumo para o hash atual e não é forçado, não re-chama a IA.
   */
  async generateSummary(
    projectId: string,
    opts: { force?: boolean } = {},
  ): Promise<void> {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
    });
    if (!project) throw new NotFoundException('Projeto não encontrado');
    const docsTreeSha = project.docsScopeHash;
    if (!docsTreeSha) {
      this.logger.warn(`Projeto ${projectId} sem sync — resumo ignorado`);
      return;
    }

    if (!opts.force) {
      const existing = await this.prisma.insight.findFirst({
        where: { projectId, kind: 'summary', docsTreeSha },
      });
      if (existing) return; // resumo já existe para este hash — ADR-002
    }

    const docs = await this.prisma.document.findMany({
      where: { projectId },
      select: { path: true, content: true },
    });
    if (docs.length === 0) return;

    const context = selectContext(docs, MAX_INPUT_TOKENS);
    const provider = await this.settings.providerOf(project.userId);
    const client = this.llmFactory.create(provider);

    const summary = await this.completeWithRetry(project.id, client, context);
    const content: StateSummary = {
      oQueE: summary.oQueE,
      ondeParou: summary.ondeParou,
      oQueFalta: summary.oQueFalta,
    };

    await this.prisma.insight.create({
      data: {
        projectId,
        kind: 'summary',
        docsTreeSha,
        provider: client.provider,
        model: summary.model,
        inputTokens: summary.inputTokens,
        outputTokens: summary.outputTokens,
        content: content as unknown as Prisma.InputJsonValue,
      },
    });
  }

  /** Resumo mais recente do projeto (leitura para a Visão Geral). */
  async latestSummary(userId: string, projectId: string) {
    await this.assertOwner(userId, projectId);
    return this.prisma.insight.findFirst({
      where: { projectId, kind: 'summary' },
      orderBy: { createdAt: 'desc' },
    });
  }

  async regenerate(userId: string, projectId: string): Promise<void> {
    await this.assertOwner(userId, projectId);
    await this.generateSummary(projectId, { force: true });
  }

  /**
   * Propõe um backlog inicial de cards a partir da documentação (SPEC-005,
   * bootstrap do Kanban). Interface pública consumida pelo board — o board
   * não sabe de LLM, só pede a proposta; a criação de issues é dele. 1 retry
   * em JSON inválido.
   */
  async proposeCards(userId: string, projectId: string): Promise<CardProposal[]> {
    await this.assertOwner(userId, projectId);
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
   * insight nunca escreve no store (ADR-001). Idempotente por docsTreeSha via
   * marker `edges_marker`. Chamado só pelo worker (ADR-002 — IA nunca no
   * caminho de render).
   */
  async generateEdges(projectId: string): Promise<void> {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
    });
    if (!project?.docsScopeHash) return;
    const hash = project.docsScopeHash;

    const marker = await this.prisma.insight.findFirst({
      where: { projectId, kind: 'edges_marker', docsTreeSha: hash },
    });
    if (marker) return; // idempotente por hash

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
    const edges = await this.completeEdges(projectId, client, docMeta, explicitPairs);

    await this.ingestion.writeInferredEdges(projectId, edges);

    await this.prisma.insight.create({
      data: {
        projectId,
        kind: 'edges_marker',
        docsTreeSha: hash,
        provider: client.provider,
        model: 'edges',
        inputTokens: 0,
        outputTokens: 0,
        content: {} as unknown as Prisma.InputJsonValue,
      },
    });
  }

  /**
   * Classifica documentos livres contra entidades ausentes (nível 3 da escada
   * ADR-014). Para cada entidade ausente (exceto deploy — CONVENTION.md), pergunta
   * à IA se algum doc livre É essa entidade pelo conteúdo, com spans obrigatórios
   * (ADR-012). Entrega a resolução ao ResolutionService — insight nunca escreve em
   * documentResolution direto (ADR-001). Idempotente por docsTreeSha via marker
   * `classify_marker`. Chamado só pelo worker (ADR-002).
   */
  async classifyAbsent(projectId: string): Promise<void> {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
    });
    if (!project?.docsScopeHash) return;
    const hash = project.docsScopeHash;

    const marker = await this.prisma.insight.findFirst({
      where: { projectId, kind: 'classify_marker', docsTreeSha: hash },
    });
    if (marker) return; // idempotente por hash

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

    let hits: ClassifyHit[] = [];
    if (freeDocs.length > 0) {
      const context = selectContext(freeDocs, MAX_INPUT_TOKENS);
      const excerptByPath = new Map(context.map((d) => [d.path, d.content]));
      const docMeta = context.map((d) => ({
        path: d.path,
        ...summarizeDoc(excerptByPath.get(d.path) ?? ''),
      }));

      const provider = await this.settings.providerOf(project.userId);
      const client = this.llmFactory.create(provider);
      hits = await this.completeClassify(project.id, client, docMeta, absentEntities);

      for (const hit of hits) {
        await this.resolution.writeInferredResolution(
          projectId,
          hit.entity,
          hit.path,
          CLASSIFY_CONFIDENCE,
        );
      }
    }

    await this.prisma.insight.create({
      data: {
        projectId,
        kind: 'classify_marker',
        docsTreeSha: hash,
        provider: 'anthropic',
        model: 'classify',
        inputTokens: 0,
        outputTokens: 0,
        content: { hits } as unknown as Prisma.InputJsonValue,
      },
    });
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
   * persistido. Idempotente por docsTreeSha via kind `${entity}_fallback`.
   * Chamado só pelo worker (ADR-002).
   */
  async generateFallback(projectId: string, entity: FallbackEntity): Promise<void> {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
    });
    if (!project?.docsScopeHash) return;
    const hash = project.docsScopeHash;
    const kind = `${entity}_fallback` as InsightKind;

    const marker = await this.prisma.insight.findFirst({
      where: { projectId, kind, docsTreeSha: hash },
    });
    if (marker) return; // idempotente por hash

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
    const req = {
      system: FALLBACK_SYSTEM,
      user: buildFallbackUser(context, entity),
      maxTokens: MAX_FALLBACK_OUTPUT_TOKENS,
    };

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
        docsTreeSha: hash,
        provider: client.provider,
        model: res.model,
        inputTokens: res.inputTokens,
        outputTokens: res.outputTokens,
        content: { markdown: res.text } as unknown as Prisma.InputJsonValue,
      },
    });
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

  /** Chama o LLM e valida o JSON de classificação; 1 retry em JSON inválido. */
  private async completeClassify(
    projectId: string,
    client: ReturnType<LlmClientFactory['create']>,
    docs: { path: string; title: string; headings: string[]; excerpt: string }[],
    absentEntities: (typeof CLASSIFIABLE_ENTITIES)[number][],
  ): Promise<ClassifyHit[]> {
    const req = {
      system: CLASSIFY_SYSTEM,
      user: buildClassifyUser(docs, absentEntities),
      maxTokens: MAX_CLASSIFY_OUTPUT_TOKENS,
    };
    return this.usage.runParsed(
      client,
      req,
      { projectId, kind: 'classify_marker' },
      parseClassify,
    );
  }

  /** Chama o LLM e valida o JSON de arestas; 1 retry em JSON inválido. */
  private async completeEdges(
    projectId: string,
    client: ReturnType<LlmClientFactory['create']>,
    docs: { path: string; title: string; headings: string[]; excerpt: string }[],
    explicitPairs: { source: string; target: string }[],
  ): Promise<InferredEdge[]> {
    const req = {
      system: EDGES_SYSTEM,
      user: buildEdgesUser(docs, explicitPairs),
      maxTokens: MAX_EDGES_OUTPUT_TOKENS,
    };
    return this.usage.runParsed(client, req, { projectId, kind: 'edges_marker' }, parseEdges);
  }

  /** Chama o LLM e valida o JSON; 1 retry em JSON inválido (SPEC-003). */
  private async completeWithRetry(
    projectId: string,
    client: ReturnType<LlmClientFactory['create']>,
    context: { path: string; content: string }[],
  ): Promise<StateSummary & { model: string; inputTokens: number; outputTokens: number }> {
    const req = {
      system: SUMMARY_SYSTEM,
      user: buildSummaryUser(context),
      maxTokens: MAX_OUTPUT_TOKENS,
    };
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
