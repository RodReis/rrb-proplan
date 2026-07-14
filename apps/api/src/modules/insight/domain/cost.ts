import { Prisma } from '@prisma/client';

type Decimal = Prisma.Decimal;
const D = Prisma.Decimal;

/** Tokens normalizados de uma chamada (vindos do adapter). */
export interface UsageTokens {
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
}

/** Tarifas de um modelo (USD por 1M tokens). Da ModelPrice. */
export interface Tariffs {
  inputPer1M: Decimal;
  outputPer1M: Decimal;
  cacheWritePer1M: Decimal;
  cacheReadPer1M: Decimal;
}

export type CostSource = 'provider' | 'table' | 'none';

export interface CostResult {
  costUsd: Decimal | null;
  costSource: CostSource;
  priceMissing: boolean;
  /** As 4 tarifas usadas, congeladas na linha (só quando costSource: table). */
  priceSnapshot: Record<string, string> | null;
}

const PER_1M = new D(1_000_000);

/** Custo de um componente = tarifa/1M × tokens, em Decimal (sem passar por number). */
function component(per1M: Decimal, tokens: number): Decimal {
  return per1M.div(PER_1M).mul(tokens);
}

/**
 * Decide a origem e calcula o custo de uma chamada (SPEC-009 §3-4).
 *
 * Ordem: custo do provedor VENCE a tabela (OpenRouter → `provider`, fato). Senão,
 * calcula da ModelPrice (`table`, inferência auditável — daí o priceSnapshot).
 * Sem tarifa cadastrada → `none` + priceMissing (a chamada aconteceu, o custo é
 * desconhecido; NUNCA fingir zero). Cada componente usa a tarifa própria — o erro
 * clássico é somar cache como input, ou reusar a tarifa de input pro cache write.
 */
export function computeCost(
  tokens: UsageTokens,
  tariffs: Tariffs | null,
  providerCostUsd: number | undefined,
): CostResult {
  if (typeof providerCostUsd === 'number') {
    return {
      costUsd: new D(providerCostUsd),
      costSource: 'provider',
      priceMissing: false,
      priceSnapshot: null,
    };
  }

  if (!tariffs) {
    return { costUsd: null, costSource: 'none', priceMissing: true, priceSnapshot: null };
  }

  const costUsd = component(tariffs.inputPer1M, tokens.inputTokens)
    .add(component(tariffs.outputPer1M, tokens.outputTokens))
    .add(component(tariffs.cacheWritePer1M, tokens.cacheCreationTokens))
    .add(component(tariffs.cacheReadPer1M, tokens.cacheReadTokens));

  return {
    costUsd,
    costSource: 'table',
    priceMissing: false,
    priceSnapshot: {
      inputPer1M: tariffs.inputPer1M.toString(),
      outputPer1M: tariffs.outputPer1M.toString(),
      cacheWritePer1M: tariffs.cacheWritePer1M.toString(),
      cacheReadPer1M: tariffs.cacheReadPer1M.toString(),
    },
  };
}
