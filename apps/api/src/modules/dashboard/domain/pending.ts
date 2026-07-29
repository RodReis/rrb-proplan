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

/**
 * O painel onde o item é resolvido — o destino do drill-down (§7.3).
 *
 * Resolvido **no servidor**, junto do item, e não montado pela tela a partir do
 * `kind`: quem sabe que "artefato pendente" se resolve no painel de artefatos é
 * quem produziu o item. A tela replicando esse mapa seria uma segunda cópia da
 * regra, e as duas divergiriam no primeiro tipo novo.
 *
 * `null` é a resposta honesta para item **sem destino pronto**, e existe porque
 * o §7.3 é explícito: *item cuja tela de destino não existe é texto, não link*.
 * Um link que leva a 404 ensina a pessoa a desconfiar de todos os outros.
 */
export type PendingTarget = 'artefatos' | 'estimativa' | 'contratos' | null;

/** Um item da lista, já normalizado — a tela não reimplementa a projeção. */
export interface PendingItem {
  kind: PendingKind;
  /**
   * Cliente dono do projeto. Viaja junto porque a gaveta do drill-down é a do
   * **cliente** (`/t/:tenant/clients?cliente=…`) — sem ele a tela teria de
   * descobrir o dono com uma segunda chamada, por item.
   */
  clientId: string;
  /** Projeto a que o item pertence. */
  clientProjectId: string;
  title: string;
  /** Texto curto do que exatamente espera. */
  detail: string;
  /** Painel de destino, ou `null` se ainda não há tela para onde levar. */
  target: PendingTarget;
  /** Desde quando espera — ISO. */
  since: string;
}
