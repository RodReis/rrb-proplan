import { BoardColumn, IssuePriority } from '../../../lib/api';

export const COLUMN_ORDER: BoardColumn[] = [
  'backlog',
  'todo',
  'doing',
  'done',
  'finalized',
  'discarded',
];

export const COLUMN_LABEL: Record<BoardColumn, string> = {
  backlog: 'Backlog',
  todo: 'A Fazer',
  doing: 'Em Andamento',
  done: 'Feito',
  finalized: 'Finalizado',
  discarded: 'Descartado',
};

/** Colunas para onde o usuário pode arrastar (Feito/Descartado inclusos). */
export const DROPPABLE_COLUMNS = COLUMN_ORDER;

export const PRIORITY_LABEL: Record<IssuePriority, string> = {
  alta: 'alta',
  media: 'média',
  baixa: 'baixa',
};

/**
 * Chip de prioridade (§6 — chip técnico: Mono, caixa alta, espaçado).
 *
 * A faixa de 3px do card não mora aqui: ela vem de `priorityColor` do
 * `stageTint.ts`, que é a fonte das cores por dado.
 */
export const PRIORITY_CHIP: Record<IssuePriority, string> = {
  alta: 'bg-error/10 text-error',
  media: 'bg-warning/15 text-warning',
  baixa: 'border border-border2 text-faint',
};
