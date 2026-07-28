import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { LlmClient, LlmRequest, LlmResponse } from '../domain/llm-client';
import { computeCost, Tariffs } from '../domain/cost';

export interface RecordContext {
  projectId: string | null;
  /** Tipo da inferência: summary | status_bootstrap | architecture_fallback | ... */
  kind: string;
  /** Nº da tentativa (a SPEC-003 faz 1 retry em JSON inválido → linha própria). */
  attempt?: number;
  /** Hash do prompt (SPEC-011) — liga esta chamada ao artefato Insight. Ausente fora do gate. */
  inputHash?: string;
  /**
   * Dono do gasto (ADR-026). **Obrigatório quando não há `projectId`**: sem um
   * dos dois, a linha nasce com `tenant_id` NULL, e a policy do `llm_usage`
   * trata NULL como *"pertence ao tenant ativo"* — o gasto de um tenant
   * apareceria no teto de quem estivesse olhando.
   *
   * Com `projectId`, o recorder o resolve sozinho (`Project.tenantId`) e este
   * campo é dispensável. O pipeline da SPEC-032 **não tem** `projectId` (é
   * `ClientProject`, outro domínio), então ele passa o tenant explicitamente.
   */
  tenantId?: string;
  /**
   * Liga a chamada ao run do pipeline de artefatos (SPEC-032 §5). É o que faz
   * *"quanto custou este briefing"* ser consulta ao **ledger**, nunca derivação
   * de `ArtifactVersion` (ADR-016).
   */
  artifactRunId?: string;
}

/**
 * Envolve `client.complete` gravando o gasto no ledger `LlmUsage` (SPEC-009).
 * Uma linha por CHAMADA — sucesso, erro (com os tokens que o provedor devolveu
 * antes de falhar), e cada retry como linha própria. O adapter normaliza os
 * tokens; aqui resolvemos a tarifa da ModelPrice e decidimos o costSource.
 *
 * Regra de ouro: **o ledger não pode derrubar a chamada**. Falha ao gravar a
 * linha é logada, não propagada — perder contabilidade é ruim; perder o resumo
 * que o usuário pediu é pior.
 */
@Injectable()
export class LlmUsageRecorder {
  private readonly logger = new Logger(LlmUsageRecorder.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Chamada com parse e retry (ex.: proposeCards, SPEC-003). Cada tentativa é
   * uma linha própria: parse ok → `ok`; parse falhou mas a próxima tentativa
   * existe → `discarded` (o token foi gasto, o artefato jogado fora); chamada
   * falhou → `error`. Assim o retry de JSON inválido gera 2 linhas (SPEC-009).
   */
  async runParsed<T>(
    client: LlmClient,
    req: LlmRequest,
    ctx: Omit<RecordContext, 'attempt'>,
    parse: (text: string, res: LlmResponse) => T,
    maxAttempts = 2,
  ): Promise<T> {
    let lastErr: unknown;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const start = Date.now();
      let res: LlmResponse;
      try {
        res = await client.complete(req);
      } catch (err) {
        await this.record(client.provider, this.modelHint(client.provider), { ...ctx, attempt }, 'error', {
          inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0,
          latencyMs: Date.now() - start,
          errorCode: err instanceof Error ? err.message.slice(0, 200) : 'erro',
        });
        throw err; // erro de chamada não faz retry aqui (só parse)
      }
      const usage = {
        inputTokens: res.inputTokens, outputTokens: res.outputTokens,
        cacheCreationTokens: res.cacheCreationTokens, cacheReadTokens: res.cacheReadTokens,
        providerCostUsd: res.providerCostUsd, latencyMs: Date.now() - start,
      };
      try {
        const parsed = parse(res.text, res);
        await this.record(client.provider, res.model, { ...ctx, attempt }, 'ok', usage);
        return parsed;
      } catch (err) {
        // parse falhou: linha descartada (gastou token, artefato jogado fora)
        await this.record(client.provider, res.model, { ...ctx, attempt }, 'discarded', usage);
        lastErr = err;
      }
    }
    throw lastErr;
  }

  /** Executa a chamada e grava a linha do ledger (sucesso ou erro). */
  async run(client: LlmClient, req: LlmRequest, ctx: RecordContext): Promise<LlmResponse> {
    const start = Date.now();
    try {
      const res = await client.complete(req);
      await this.record(client.provider, res.model, ctx, 'ok', {
        inputTokens: res.inputTokens,
        outputTokens: res.outputTokens,
        cacheCreationTokens: res.cacheCreationTokens,
        cacheReadTokens: res.cacheReadTokens,
        providerCostUsd: res.providerCostUsd,
        latencyMs: Date.now() - start,
      });
      return res;
    } catch (err) {
      // Timeout puro não tem usage → grava 0 com status error (serve à taxa de
      // desperdício). Modelo resolvido pelo env quando a resposta não veio.
      await this.record(client.provider, this.modelHint(client.provider), ctx, 'error', {
        inputTokens: 0,
        outputTokens: 0,
        cacheCreationTokens: 0,
        cacheReadTokens: 0,
        latencyMs: Date.now() - start,
        errorCode: err instanceof Error ? err.message.slice(0, 200) : 'erro',
      });
      throw err;
    }
  }

  /**
   * Grava uma linha de descarte (SPEC-009): proposta de bootstrap que o usuário
   * gerou mas não aprovou — o token foi gasto, a linha existe. O custo já foi
   * apurado no `run` que gerou a proposta; aqui só se precisar de linha extra.
   * (No fluxo atual a geração já grava via `run`; este método fica para o caso
   * de descarte explícito sem nova chamada.)
   */
  async recordDiscarded(
    provider: string,
    model: string,
    ctx: RecordContext,
    tokens: { inputTokens: number; outputTokens: number; cacheCreationTokens: number; cacheReadTokens: number },
  ): Promise<void> {
    await this.record(provider, model, ctx, 'discarded', tokens);
  }

  private async record(
    provider: string,
    model: string,
    ctx: RecordContext,
    status: 'ok' | 'error' | 'discarded',
    usage: {
      inputTokens: number;
      outputTokens: number;
      cacheCreationTokens: number;
      cacheReadTokens: number;
      providerCostUsd?: number;
      latencyMs?: number;
      errorCode?: string;
    },
  ): Promise<void> {
    try {
      const tariffs = await this.tariffsFor(provider, model);
      const cost = computeCost(usage, tariffs, usage.providerCostUsd);
      await this.prisma.llmUsage.create({
        data: {
          projectId: ctx.projectId,
          tenantId: await this.tenantOf(ctx),
          artifactRunId: ctx.artifactRunId ?? null,
          kind: ctx.kind,
          provider,
          model,
          attempt: ctx.attempt ?? 1,
          status,
          inputHash: ctx.inputHash ?? null,
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
          cacheCreationTokens: usage.cacheCreationTokens,
          cacheReadTokens: usage.cacheReadTokens,
          costUsd: cost.costUsd,
          costSource: cost.costSource,
          priceMissing: cost.priceMissing,
          priceSnapshot: (cost.priceSnapshot ?? Prisma.JsonNull) as Prisma.InputJsonValue,
          pricedAt: cost.costSource === 'table' ? new Date() : null,
          errorCode: usage.errorCode ?? null,
          latencyMs: usage.latencyMs ?? null,
        },
      });
    } catch (err) {
      // NÃO propaga: o ledger nunca derruba o trabalho do usuário.
      this.logger.warn(
        `Falha ao gravar LlmUsage (${provider}/${model}, ${ctx.kind}): ${err instanceof Error ? err.message : err}`,
      );
    }
  }

  /**
   * Dono do gasto. Explícito quando o chamador o informa; senão, resolvido do
   * projeto.
   *
   * **Por que isto não existia até agora, e por que é um bug e não um detalhe**:
   * a coluna `tenant_id` nasceu na Fatia 8 com um backfill único, e nada nunca
   * a preencheu depois — toda linha gravada desde então tem NULL. A policy do
   * `llm_usage` aceita NULL de propósito (o histórico órfão pertence ao tenant
   * ativo, decisão F4), então nada quebrou e ninguém viu. O que a SPEC-032
   * cobra é justamente o caso em que isso deixa de ser inofensivo: o pipeline
   * roda **sem sessão**, e uma linha NULL faria o gasto do briefing de um
   * tenant ser somado no teto de qualquer um que olhasse.
   *
   * Falha na resolução devolve `null` em vez de estourar: a regra de ouro do
   * recorder é que o ledger nunca derruba a chamada. Linha sem tenant é ruim;
   * perder o trabalho que o usuário pediu é pior.
   */
  private async tenantOf(ctx: RecordContext): Promise<string | null> {
    if (ctx.tenantId) return ctx.tenantId;
    if (!ctx.projectId) return null;
    try {
      const project = await this.prisma.project.findUnique({
        where: { id: ctx.projectId },
        select: { tenantId: true },
      });
      return project?.tenantId ?? null;
    } catch {
      return null;
    }
  }

  /** Tarifas vigentes do modelo (a mais recente por effectiveFrom), ou null. */
  private async tariffsFor(provider: string, model: string): Promise<Tariffs | null> {
    const price = await this.prisma.modelPrice.findFirst({
      where: { provider, model },
      orderBy: { effectiveFrom: 'desc' },
    });
    if (!price) return null;
    return {
      inputPer1M: price.inputPer1M,
      outputPer1M: price.outputPer1M,
      cacheWritePer1M: price.cacheWritePer1M,
      cacheReadPer1M: price.cacheReadPer1M,
    };
  }

  private modelHint(provider: string): string {
    if (provider === 'anthropic') return process.env.LLM_MODEL_ANTHROPIC ?? 'claude-sonnet-5';
    if (provider === 'openai') return process.env.LLM_MODEL_OPENAI ?? 'gpt-4o';
    if (provider === 'openrouter') return process.env.LLM_MODEL_OPENROUTER ?? 'unknown';
    return 'unknown';
  }
}
