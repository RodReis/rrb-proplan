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
