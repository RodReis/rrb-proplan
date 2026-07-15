/**
 * Confiança determinística (ADR-012, SPEC-014) — PURO, sem IA, sem banco.
 *
 * O número é função apenas de metadado: mesmo repo + mesmo docsScopeHash →
 * mesmo score, sempre (testável por fixture, não "avaliação"). O LLM nunca
 * emite o score.
 *
 * Nesta fatia (decisão 2 do PI) só `staleness` e `cobertura` calculam;
 * `contradicao` e `drift` são slots de **peso zero** — entram na conta exibida
 * (transparência) mas não movem o número. Fatias próprias os ativam.
 */

export interface ConfidenceSignals {
  /** Dias entre o último commit de código e o último commit em docs (ADR-010). */
  stalenessDays: number;
  /** Fração de credibilidade da resolução [0,1] — nível de resolução modula. */
  cobertura: number;
  /** Slot (peso zero nesta fatia): nº de pares de spans conflitantes. */
  contradicao: number;
  /** Slot (peso zero nesta fatia): nº de artefatos afirmados sem confirmação. */
  drift: number;
}

export interface Confidence {
  score: number;
  math: ConfidenceSignals;
}

/** Meia-vida do decaimento por staleness, em dias. Alinhado ao limiar do ADR-010
 *  (90 dias): aos 90 dias de defasagem o fator cai à metade. */
const STALENESS_HALFLIFE_DAYS = 90;

/**
 * score = cobertura × stalenessFactor, ambos em [0,1].
 * - cobertura é o piso: sem doc resolvido, não há confiança (multiplicativo).
 * - stalenessFactor decai exponencialmente com a idade da doc vs. código.
 * contradicao/drift têm peso zero (slots) — reportados em `math`, fora do cálculo.
 */
export function computeConfidence(signals: ConfidenceSignals): Confidence {
  const cobertura = clamp01(signals.cobertura);
  const stalenessDays = Math.max(0, signals.stalenessDays);
  const stalenessFactor = Math.pow(0.5, stalenessDays / STALENESS_HALFLIFE_DAYS);
  const score = clamp01(cobertura * stalenessFactor);
  return {
    score: round4(score),
    math: {
      stalenessDays: signals.stalenessDays,
      cobertura: signals.cobertura,
      contradicao: signals.contradicao,
      drift: signals.drift,
    },
  };
}

/** Recusa: score abaixo do limiar → não responde (palpite proibido). Limiar 0
 *  desliga (mostra tudo com a confiança crua). */
export function belowThreshold(score: number, threshold: number): boolean {
  if (threshold <= 0) return false;
  return score < threshold;
}

function clamp01(n: number): number {
  if (Number.isNaN(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}
