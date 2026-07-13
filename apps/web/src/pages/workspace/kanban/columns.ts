import { BoardColumn, IssuePriority } from '../../../lib/api';

export const COLUMN_ORDER: BoardColumn[] = [
  'backlog',
  'todo',
  'doing',
  'done',
  'discarded',
];

export const COLUMN_LABEL: Record<BoardColumn, string> = {
  backlog: 'Backlog',
  todo: 'A Fazer',
  doing: 'Em Andamento',
  done: 'Feito',
  discarded: 'Descartado',
};

/** Colunas para onde o usuário pode arrastar (Feito/Descartado inclusos). */
export const DROPPABLE_COLUMNS = COLUMN_ORDER;

export const PRIORITY_LABEL: Record<IssuePriority, string> = {
  alta: 'alta',
  media: 'média',
  baixa: 'baixa',
};

/** Classe da faixa de prioridade (variação B do card) — cor semântica. */
export const PRIORITY_STRIPE: Record<IssuePriority, string> = {
  alta: 'bg-error',
  media: 'bg-warning',
  baixa: 'bg-border',
};

export const PRIORITY_CHIP: Record<IssuePriority, string> = {
  alta: 'bg-error/10 text-error',
  media: 'bg-warning/15 text-warning',
  baixa: 'bg-surface-hover text-text-muted border border-border',
};
