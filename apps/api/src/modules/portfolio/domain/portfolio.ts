/**
 * Portfólio + Radar de risco (SPEC-019, Fatia 14) — projeção PURA, sem banco,
 * sem rede, sem IA. Recebe os 4 sinais entregues já coletados (staleness,
 * cobertura, deploy, CI) e monta as linhas + o ranking por atenção.
 *
 * Regra do radar (decisão do PI, 2026-07-15): ordena por CONTAGEM de sinais em
 * vermelho, desempate por staleness. Nunca um score de saúde composto (ADR-012)
 * — os sinais ficam lado a lado, crus e datados; o rank só os conta.
 *
 * Extensível (decisão 3 do PI): os slots de constraints-`a-revalidar` (Fatia 10)
 * e blockers (Fatia 11) são campos opcionais somados com PESO ZERO. Não entram
 * na conta hoje; quando a fatia entregar, viram input sem reescrever o radar.
 */

/** Estado cru de um sinal: valor + se está "vermelho" + a data em que foi lido. */
export interface Signal {
  /** Sinal aponta atenção agora? (a regra de "vermelho" é do call site) */
  red: boolean;
  observedAt: string | null;
}

/** Entrada por projeto — os 4 sinais entregues + os 2 slots peso-zero. */
export interface PortfolioInput {
  projectId: string;
  name: string;
  owner: string;
  /** Dias que o código está à frente dos docs (ADR-010); null = sem base. */
  stalenessDays: number | null;
  /** Sinais entregues. `null` = fonte silenciou (não coletada / neutra). */
  staleness: Signal | null;
  coverage: Signal | null;
  deploy: Signal | null;
  ci: Signal | null;
  /**
   * Slots peso-zero (Fatias 10/11). Declarados, NÃO calculados hoje: mesmo
   * `red: true` não entra na contagem até o peso deixar de ser zero.
   */
  revalidate?: Signal | null;
  blockers?: Signal | null;
}

export interface PortfolioRow extends PortfolioInput {
  /** Quantos sinais entregues estão em vermelho (0..4). Slots 10/11 fora. */
  redCount: number;
}

/**
 * Pesos por sinal no radar. Os 4 entregues pesam 1; os slots de 10/11 pesam 0
 * (declarados, não calculados — decisão 3 do PI). Subir um peso quando a fatia
 * que o calcula entregar é a ÚNICA mudança necessária — sem reescrever a conta.
 */
const WEIGHTS: Record<string, number> = {
  staleness: 1,
  coverage: 1,
  deploy: 1,
  ci: 1,
  revalidate: 0, // Fatia 10 — slot peso-zero
  blockers: 0, // Fatia 11 — slot peso-zero
};

/** Conta os sinais em vermelho ponderados pelo peso (slots peso-zero não somam). */
function countReds(input: PortfolioInput): number {
  let n = 0;
  for (const key of Object.keys(WEIGHTS)) {
    const sig = input[key as keyof PortfolioInput] as Signal | null | undefined;
    if (sig?.red) n += WEIGHTS[key];
  }
  return n;
}

/** Monta as linhas (projeção pura, mesma ordem de entrada). */
export function assemblePortfolio(inputs: PortfolioInput[]): PortfolioRow[] {
  return inputs.map((input) => ({ ...input, redCount: countReds(input) }));
}

/**
 * Ordena por atenção: mais sinais vermelhos primeiro; empate → maior staleness
 * primeiro; empate ainda → nome (estável, para determinismo total). Não muta a
 * entrada. Determinístico: mesma entrada → mesma ordem (critério de aceite).
 */
export function rankByRisk(rows: PortfolioRow[]): PortfolioRow[] {
  return [...rows].sort((a, b) => {
    if (b.redCount !== a.redCount) return b.redCount - a.redCount;
    const sa = a.stalenessDays ?? -1;
    const sb = b.stalenessDays ?? -1;
    if (sb !== sa) return sb - sa;
    return a.name.localeCompare(b.name);
  });
}
