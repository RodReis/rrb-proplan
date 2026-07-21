// Mapeamento entre GitHub Issue e coluna do board (SPEC-005 / ADR-011).
// Issue tem só open/closed; as 6 colunas moram em labels `proplan:*` + o
// estado nativo. Puro e determinístico — testável sem tocar na API.

export type BoardColumn =
  | 'backlog'
  | 'todo'
  | 'doing'
  | 'done'
  | 'finalized'
  | 'discarded';
export type IssuePriority = 'alta' | 'media' | 'baixa';
export type IssueState = 'open' | 'closed';

// Colunas ABERTAS têm label própria (a issue continua `open`). Feito entra aqui:
// ADR-011 (corrigido 2026-07-13) — "Feito é uma fila com dono", trabalho
// entregue aguardando aceite; a issue só fecha quando o dono aceita (Finalizado).
export const COLUMN_LABEL: Record<'backlog' | 'todo' | 'doing' | 'done', string> = {
  backlog: 'proplan:backlog',
  todo: 'proplan:todo',
  doing: 'proplan:doing',
  done: 'proplan:done',
};
export const FINALIZED_LABEL = 'proplan:finalizado';
export const DISCARDED_LABEL = 'proplan:descartado';
export const PRIORITY_LABELS: Record<IssuePriority, string> = {
  alta: 'prio:alta',
  media: 'prio:media',
  baixa: 'prio:baixa',
};

// Todas as colunas na ordem de exibição do board (SPEC-005, 6 colunas).
export const COLUMNS: BoardColumn[] = [
  'backlog',
  'todo',
  'doing',
  'done',
  'finalized',
  'discarded',
];

// Labels de coluna aberta (removidas ao fechar uma issue). Feito é aberta (ADR-011).
const OPEN_COLUMN_LABELS = [
  COLUMN_LABEL.backlog,
  COLUMN_LABEL.todo,
  COLUMN_LABEL.doing,
  COLUMN_LABEL.done,
];

/**
 * Coluna de uma issue a partir do estado nativo e das labels (SPEC-005, ADR-011
 * corrigido em 2026-07-13). Aberta: segue a label `proplan:*` — inclusive
 * **Feito** (`open` + `proplan:done`, *entregue aguardando aceite*); sem label =
 * Backlog. Fechada: `proplan:finalizado` → Finalizado (aceito pelo dono);
 * `proplan:descartado` → Descartado; **sem label → Finalizado** ("fechada fora
 * do ProPlan" — em repo comum `closed` significa concluído; a ausência de
 * evidência de aceite é sinalizada por badge, não disfarçada — ver `closedOutside`).
 */
export function columnOf(state: IssueState, labels: string[]): BoardColumn {
  const has = (l: string) => labels.includes(l);
  if (state === 'closed') {
    if (has(DISCARDED_LABEL)) return 'discarded';
    return 'finalized'; // proplan:finalizado OU sem label (fechada fora do ProPlan)
  }
  if (has(COLUMN_LABEL.done)) return 'done';
  if (has(COLUMN_LABEL.doing)) return 'doing';
  if (has(COLUMN_LABEL.todo)) return 'todo';
  return 'backlog'; // proplan:backlog ou sem label proplan:*
}

/**
 * Uma issue `closed` sem label `proplan:*` foi fechada fora do fluxo do ProPlan
 * (direto no GitHub, ou por `closes #N` de um PR qualquer). Cai em Finalizado,
 * mas com badge "fechada fora do ProPlan" — a falta de evidência de aceite é
 * sinalizada, nunca disfarçada (SPEC-005, critério da linha 119).
 */
export function isClosedOutsideProplan(state: IssueState, labels: string[]): boolean {
  return state === 'closed' && !labels.includes(FINALIZED_LABEL) && !labels.includes(DISCARDED_LABEL);
}

/**
 * Épico estrutural (SPEC-024): é épico toda issue que *tem* sub-issues. Épico é
 * faixa/agrupador, não anda pelas colunas — `getBoard` o exclui da classificação
 * de coluna e o expõe como cabeçalho. A label `proplan:mvp` é opcional e não
 * entra nesta decisão (a estrutura manda, não o rótulo).
 */
export function isEpic(hasSubIssues: boolean): boolean {
  return hasSubIssues;
}

/** Prioridade a partir das labels `prio:*` (a primeira que casar). */
export function priorityOf(labels: string[]): IssuePriority | null {
  if (labels.includes(PRIORITY_LABELS.alta)) return 'alta';
  if (labels.includes(PRIORITY_LABELS.media)) return 'media';
  if (labels.includes(PRIORITY_LABELS.baixa)) return 'baixa';
  return null;
}

/** Colunas fechadas que exigem um comentário de carimbo ao serem alcançadas. */
export const STAMPED_COLUMNS: BoardColumn[] = ['finalized', 'discarded'];

export interface ColumnTransition {
  state: IssueState;
  addLabels: string[];
  removeLabels: string[];
}

/**
 * Mudanças para levar uma issue à coluna destino (SPEC-005, tabela de mutações).
 * Devolve o estado alvo e o diff de labels de coluna — a prioridade não é tocada
 * aqui (mutação separada). As três colunas fechadas (Feito/Finalizado/Descartado)
 * são mutuamente exclusivas: cada uma remove as labels das outras.
 */
export function transitionTo(target: BoardColumn): ColumnTransition {
  const allColumnLabels = [...OPEN_COLUMN_LABELS, FINALIZED_LABEL, DISCARDED_LABEL];
  switch (target) {
    case 'backlog':
    case 'todo':
    case 'doing':
    case 'done':
      // Todas ABERTAS (ADR-011). Feito = `open` + `proplan:done` — entregue,
      // aguardando aceite; a issue NÃO fecha (só Finalizado/Descartado fecham).
      return {
        state: 'open',
        addLabels: [COLUMN_LABEL[target]],
        removeLabels: allColumnLabels.filter((l) => l !== COLUMN_LABEL[target]),
      };
    case 'finalized':
      // Fechada + finalizado (aceito pelo PI). Nunca open (senão closes #N mentiria).
      return {
        state: 'closed',
        addLabels: [FINALIZED_LABEL],
        removeLabels: allColumnLabels.filter((l) => l !== FINALIZED_LABEL),
      };
    case 'discarded':
      // Fechada + descartado.
      return {
        state: 'closed',
        addLabels: [DISCARDED_LABEL],
        removeLabels: allColumnLabels.filter((l) => l !== DISCARDED_LABEL),
      };
    default:
      // Coluna inválida (ex.: o front mandou um número em vez da coluna) —
      // falha explícita em vez de `undefined.removeLabels` lá no applier.
      throw new Error(`Coluna de destino inválida: ${JSON.stringify(target)}`);
  }
}
