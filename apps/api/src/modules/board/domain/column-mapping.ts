// Mapeamento entre GitHub Issue e coluna do board (SPEC-005 / ADR-011).
// Issue tem só open/closed; as 5 colunas moram em labels `proplan:*` + o
// estado nativo. Puro e determinístico — testável sem tocar na API.

export type BoardColumn = 'backlog' | 'todo' | 'doing' | 'done' | 'discarded';
export type IssuePriority = 'alta' | 'media' | 'baixa';
export type IssueState = 'open' | 'closed';

export const COLUMN_LABEL: Record<'backlog' | 'todo' | 'doing', string> = {
  backlog: 'proplan:backlog',
  todo: 'proplan:todo',
  doing: 'proplan:doing',
};
export const DISCARDED_LABEL = 'proplan:descartado';
export const PRIORITY_LABELS: Record<IssuePriority, string> = {
  alta: 'prio:alta',
  media: 'prio:media',
  baixa: 'prio:baixa',
};

// Todas as colunas na ordem de exibição do board.
export const COLUMNS: BoardColumn[] = ['backlog', 'todo', 'doing', 'done', 'discarded'];

/**
 * Coluna de uma issue a partir do estado nativo e das labels.
 * `closed` + descartado → discarded; `closed` → done; aberta segue a label
 * `proplan:*` (sem label = backlog, o default da spec).
 */
export function columnOf(state: IssueState, labels: string[]): BoardColumn {
  const has = (l: string) => labels.includes(l);
  if (state === 'closed') {
    return has(DISCARDED_LABEL) ? 'discarded' : 'done';
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

export interface ColumnTransition {
  state: IssueState;
  addLabels: string[];
  removeLabels: string[];
}

/**
 * Mudanças para levar uma issue à coluna destino (SPEC-005, tabela de mutações).
 * Devolve o estado alvo e o diff de labels `proplan:*`/descartado — a prioridade
 * não é tocada aqui (é mutação separada). Idempotente: mover para onde já está
 * ainda produz o alvo consistente.
 */
export function transitionTo(target: BoardColumn): ColumnTransition {
  const allColumnLabels = [
    COLUMN_LABEL.backlog,
    COLUMN_LABEL.todo,
    COLUMN_LABEL.doing,
    DISCARDED_LABEL,
  ];
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
      // Fechada sem descartado. Remove qualquer label de coluna aberta.
      return { state: 'closed', addLabels: [], removeLabels: allColumnLabels };
    case 'discarded':
      // Fechada com descartado. Remove as labels de coluna aberta.
      return {
        state: 'closed',
        addLabels: [DISCARDED_LABEL],
        removeLabels: [COLUMN_LABEL.backlog, COLUMN_LABEL.todo, COLUMN_LABEL.doing],
      };
  }
}
