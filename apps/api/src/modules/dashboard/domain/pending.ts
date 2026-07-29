/**
 * *Esperando você* — a lista fechada de 4 itens (SPEC-035 §2.3, decisão 3 do
 * PI).
 *
 * **Constante nomeada, não literais espalhados.** É o padrão da allowlist do
 * PR-4 da SPEC-033, e o critério de aceite o cita por nome: um 5º tipo entrar
 * sem decisão do PI quebra o teste de conteúdo antes de chegar na tela.
 *
 * **O contador do menu é o tamanho desta lista, sempre** (§2.3). Se o número do
 * menu e a lista da tela puderem divergir, o contador vira enfeite — e a pessoa
 * aprende a ignorá-lo, que é pior do que não existir. Por isso lista e contador
 * saem do **mesmo caminho de dado**, e há teste comparando os dois.
 */
export const PENDING_KINDS = [
  /** Artefatos em `PENDING_REVIEW` (SPEC-032). */
  'artifact_review',
  /** Briefing sem estimativa, ou estimativa sem aprovação (SPEC-031/033). */
  'estimate',
  /** Contrato emitido sem aceite registrado (SPEC-034). */
  'contract_acceptance',
  /** Cards parados além do limite configurado. */
  'stalled',
] as const;

export type PendingKind = (typeof PENDING_KINDS)[number];

export function isPendingKind(valor: string): valor is PendingKind {
  return (PENDING_KINDS as readonly string[]).includes(valor);
}

/** Um item da lista, já normalizado — a tela não reimplementa a projeção. */
export interface PendingItem {
  kind: PendingKind;
  /** Projeto a que o item pertence — é o destino do drill-down. */
  clientProjectId: string;
  title: string;
  /** Texto curto do que exatamente espera. */
  detail: string;
  /** Desde quando espera — ISO. */
  since: string;
}
