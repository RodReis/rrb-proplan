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

export const COLUMN_LABEL: Record<'backlog' | 'todo' | 'doing', string> = {
  backlog: 'proplan:backlog',
  todo: 'proplan:todo',
  doing: 'proplan:doing',
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

// Labels de coluna aberta (removidas ao fechar uma issue).
const OPEN_COLUMN_LABELS = [COLUMN_LABEL.backlog, COLUMN_LABEL.todo, COLUMN_LABEL.doing];

/**
 * Coluna de uma issue a partir do estado nativo e das labels (SPEC-005).
 * Fechada: `proplan:finalizado` → Finalizado (aceito pelo PI); `proplan:descartado`
 * → Descartado; sem label → Feito (entregue, aguardando aceite — é onde `closes #N`
 * cai, nunca em Finalizado). Aberta: segue a label `proplan:*` (sem label = Backlog).
 */
export function columnOf(state: IssueState, labels: string[]): BoardColumn {
  const has = (l: string) => labels.includes(l);
  if (state === 'closed') {
    if (has(FINALIZED_LABEL)) return 'finalized';
    if (has(DISCARDED_LABEL)) return 'discarded';
    return 'done';
  }
  if (has(COLUMN_LABEL.doing)) return 'doing';
  if (has(COLUMN_LABEL.todo)) return 'todo';
  return 'backlog'; // proplan:backlog ou sem label proplan:*
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
      return {
        state: 'open',
        addLabels: [COLUMN_LABEL[target]],
        removeLabels: allColumnLabels.filter((l) => l !== COLUMN_LABEL[target]),
      };
    case 'done':
      // Fechada, sem label de coluna. Aguarda aceite do PI.
      return { state: 'closed', addLabels: [], removeLabels: allColumnLabels };
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
  }
}
