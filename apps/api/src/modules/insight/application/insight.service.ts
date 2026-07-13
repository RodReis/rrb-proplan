import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { SettingsService } from '../../settings/application/settings.service';
import { IngestionService } from '../../ingestion/application/ingestion.service';
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
import { summarizeDoc } from '../domain/summarize-doc';
import { LlmClientFactory } from '../infrastructure/llm-client.factory';

/** Teto de tokens de entrada por resumo (cap de custo — SPEC-003). */
const MAX_INPUT_TOKENS = 12_000;
const MAX_OUTPUT_TOKENS = 1024;
const MAX_EDGES_OUTPUT_TOKENS = 2048;

@Injectable()
export class InsightService {
  private readonly logger = new Logger(InsightService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly llmFactory: LlmClientFactory,
    private readonly ingestion: IngestionService,
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

    const summary = await this.completeWithRetry(client, context);
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

    let lastErr: unknown;
    for (let attempt = 0; attempt < 2; attempt++) {
      const res = await client.complete(req);
      try {
        return parseCards(res.text);
      } catch (err) {
        lastErr = err;
        this.logger.warn(
          `Proposta de cards inválida (tentativa ${attempt + 1}): ${
            err instanceof Error ? err.message : err
          }`,
        );
      }
    }
    throw lastErr;
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
    const edges = await this.completeEdges(client, docMeta, explicitPairs);

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

  /** Chama o LLM e valida o JSON de arestas; 1 retry em JSON inválido. */
  private async completeEdges(
    client: ReturnType<LlmClientFactory['create']>,
    docs: { path: string; title: string; headings: string[]; excerpt: string }[],
    explicitPairs: { source: string; target: string }[],
  ): Promise<InferredEdge[]> {
    const req = {
      system: EDGES_SYSTEM,
      user: buildEdgesUser(docs, explicitPairs),
      maxTokens: MAX_EDGES_OUTPUT_TOKENS,
    };
    let lastErr: unknown;
    for (let attempt = 0; attempt < 2; attempt++) {
      const res = await client.complete(req);
      try {
        return parseEdges(res.text);
      } catch (err) {
        lastErr = err;
        this.logger.warn(
          `Arestas inválidas (tentativa ${attempt + 1}): ${
            err instanceof Error ? err.message : err
          }`,
        );
      }
    }
    throw lastErr;
  }

  /** Chama o LLM e valida o JSON; 1 retry em JSON inválido (SPEC-003). */
  private async completeWithRetry(
    client: ReturnType<LlmClientFactory['create']>,
    context: { path: string; content: string }[],
  ): Promise<StateSummary & { model: string; inputTokens: number; outputTokens: number }> {
    const req = {
      system: SUMMARY_SYSTEM,
      user: buildSummaryUser(context),
      maxTokens: MAX_OUTPUT_TOKENS,
    };
    let lastErr: unknown;
    for (let attempt = 0; attempt < 2; attempt++) {
      const res = await client.complete(req);
      try {
        const parsed = parseSummary(res.text);
        return {
          ...parsed,
          model: res.model,
          inputTokens: res.inputTokens,
          outputTokens: res.outputTokens,
        };
      } catch (err) {
        lastErr = err;
        this.logger.warn(
          `Resumo inválido (tentativa ${attempt + 1}): ${
            err instanceof Error ? err.message : err
          }`,
        );
      }
    }
    throw lastErr;
  }

  private async assertOwner(userId: string, projectId: string): Promise<void> {
    const p = await this.prisma.project.findFirst({
      where: { id: projectId, userId },
      select: { id: true },
    });
    if (!p) throw new NotFoundException('Projeto não encontrado');
  }
}
