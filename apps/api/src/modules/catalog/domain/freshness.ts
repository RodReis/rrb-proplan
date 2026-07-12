const MS_PER_DAY = 24 * 60 * 60 * 1000;

export interface Freshness {
  lastDocsCommitAt: Date | null;
  lastCodeCommitAt: Date | null;
  thresholdDays: number;
  /** true = docs possivelmente defasados (código à frente além do limiar). */
  stale: boolean;
}

/**
 * Regra do alerta de defasagem (ADR-010), calculada SEMPRE na leitura —
 * nunca persistida, senão mudar o limiar exigiria re-sync.
 *
 * Stale quando o código está à frente dos docs por mais que o limiar.
 * `thresholdDays = 0` desliga o alerta. Datas nulas → não stale
 * (repo sem docs ou falha na coleta = "sem documentação", não defasagem).
 */
export function computeFreshness(
  lastDocsCommitAt: Date | null,
  lastCodeCommitAt: Date | null,
  thresholdDays: number,
): Freshness {
  let stale = false;
  if (
    thresholdDays > 0 &&
    lastDocsCommitAt !== null &&
    lastCodeCommitAt !== null &&
    lastCodeCommitAt.getTime() > lastDocsCommitAt.getTime()
  ) {
    const gapDays =
      (lastCodeCommitAt.getTime() - lastDocsCommitAt.getTime()) / MS_PER_DAY;
    stale = gapDays > thresholdDays;
  }
  return { lastDocsCommitAt, lastCodeCommitAt, thresholdDays, stale };
}
