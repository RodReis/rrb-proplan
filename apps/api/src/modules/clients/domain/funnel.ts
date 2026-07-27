import { ClientProjectState } from '@prisma/client';

/**
 * Máquina de estados do funil de clientes (SPEC-029, MVP3 §5).
 *
 * Regra de negócio PURA — sem Prisma, sem HTTP, sem Nest. Ela é a autoridade
 * sobre o que é transição legítima; o service só a consulta e persiste. Isso é
 * o que cumpre a regra não-negociável do MVP3 §9 ("regra de negócio nunca em
 * página, componente ou handler") e o que permite testar o funil inteiro sem
 * banco.
 *
 * Os 10 estados internos são mais finos que as 4 colunas da UI: a coluna é
 * projeção (ver `COLUMN_OF`), o estado é o fato. Mover um card na UI escolhe
 * uma COLUNA; o servidor traduz para o estado de entrada daquela coluna e
 * valida a transição — a UI nunca dita o estado interno.
 */

/** As 4 colunas do Kanban, na ordem de exibição. */
export const FUNNEL_COLUMNS = [
  'novo',
  'briefing',
  'prompt_contrato',
  'producao_entrega',
] as const;

export type FunnelColumn = (typeof FUNNEL_COLUMNS)[number];

/** Coluna em que cada estado interno aparece. */
export const COLUMN_OF: Record<ClientProjectState, FunnelColumn> = {
  DRAFT: 'novo',
  LINK_SENT: 'novo',
  BRIEFING_STARTED: 'briefing',
  BRIEFING_SUBMITTED: 'briefing',
  ARTIFACTS_READY: 'prompt_contrato',
  CONTRACT_PENDING: 'prompt_contrato',
  CONTRACT_APPROVED: 'prompt_contrato',
  IN_PRODUCTION: 'producao_entrega',
  DELIVERED: 'producao_entrega',
  ARCHIVED: 'producao_entrega',
};

/**
 * Estado de ENTRADA de cada coluna — para onde um drag-and-drop leva.
 *
 * Arrastar um card para "Briefing" não pode significar "escolha um dos dois
 * estados dessa coluna": a UI move colunas, então o alvo tem de ser único e
 * determinístico. Avançar DENTRO da coluna (ex.: BRIEFING_STARTED →
 * BRIEFING_SUBMITTED) acontece por transição explícita, não por arrasto.
 */
export const ENTRY_STATE_OF: Record<FunnelColumn, ClientProjectState> = {
  novo: 'DRAFT',
  briefing: 'BRIEFING_STARTED',
  prompt_contrato: 'ARTIFACTS_READY',
  producao_entrega: 'IN_PRODUCTION',
};

/**
 * Transições permitidas. Deliberadamente NÃO é "qualquer estado para qualquer
 * estado": o funil é um fluxo, e pular etapa (DRAFT → IN_PRODUCTION) é o caso
 * que a spec exige recusar com 422.
 *
 * O desenho aqui é: avançar um passo, voltar um passo (correção de engano é
 * rotina, não exceção), e arquivar de quase qualquer lugar. Estados avançados
 * são alcançáveis manualmente nesta fatia — a automação (submit do briefing
 * move o card) chega na fatia do briefing público.
 */
const ALLOWED: Record<ClientProjectState, readonly ClientProjectState[]> = {
  DRAFT: ['LINK_SENT', 'BRIEFING_STARTED', 'BRIEFING_SUBMITTED', 'ARCHIVED'],
  // `→ BRIEFING_SUBMITTED` não é pular etapa: é o briefing chegando inteiro.
  // O card entra em BRIEFING_STARTED no primeiro save do rascunho, mas esse
  // move é best-effort (falha nele não derruba o save) — quando ele não
  // acontece, o submit chegava a um card ainda em LINK_SENT, a transição era
  // recusada com 422 e o `catch` silencioso do `moveCard` engolia: briefing
  // respondido no banco e card parado na coluna "Novo". Sem esta linha o
  // sintoma é invisível — nada falha, o card só não anda.
  LINK_SENT: ['BRIEFING_STARTED', 'BRIEFING_SUBMITTED', 'DRAFT', 'ARCHIVED'],
  BRIEFING_STARTED: ['BRIEFING_SUBMITTED', 'LINK_SENT', 'ARCHIVED'],
  BRIEFING_SUBMITTED: ['ARTIFACTS_READY', 'BRIEFING_STARTED', 'ARCHIVED'],
  ARTIFACTS_READY: ['CONTRACT_PENDING', 'BRIEFING_SUBMITTED', 'ARCHIVED'],
  CONTRACT_PENDING: ['CONTRACT_APPROVED', 'ARTIFACTS_READY', 'ARCHIVED'],
  CONTRACT_APPROVED: ['IN_PRODUCTION', 'CONTRACT_PENDING', 'ARCHIVED'],
  IN_PRODUCTION: ['DELIVERED', 'CONTRACT_APPROVED', 'ARCHIVED'],
  DELIVERED: ['ARCHIVED', 'IN_PRODUCTION'],
  // Terminal: sair do arquivo é "desarquivar" — volta ao começo do fluxo, de
  // onde o operador reencaminha. Não devolvemos ao estado anterior porque não
  // guardamos qual era (a trilha guarda, mas ressuscitar por ela seria
  // adivinhação sobre um card que ficou parado).
  ARCHIVED: ['DRAFT'],
};

export function canTransition(
  from: ClientProjectState,
  to: ClientProjectState,
): boolean {
  return ALLOWED[from].includes(to);
}

/** Destinos válidos a partir de um estado — a UI usa para não oferecer o que o servidor recusaria. */
export function allowedTransitions(
  from: ClientProjectState,
): readonly ClientProjectState[] {
  return ALLOWED[from];
}

/**
 * Traduz o alvo de um drag-and-drop (coluna) para o estado a persistir.
 *
 * Devolve `null` quando o card já está na coluna destino: mover dentro da
 * mesma coluna não é transição, e transformar isso num `DRAFT → DRAFT` sujaria
 * a trilha com ruído que não aconteceu.
 */
export function stateForColumnMove(
  current: ClientProjectState,
  target: FunnelColumn,
): ClientProjectState | null {
  if (COLUMN_OF[current] === target) return null;
  return ENTRY_STATE_OF[target];
}

export function isFunnelColumn(value: string): value is FunnelColumn {
  return (FUNNEL_COLUMNS as readonly string[]).includes(value);
}
