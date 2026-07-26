import { useDroppable } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { memo, useMemo, useState } from 'react';
import { BoardCard, BoardColumn, BoardEpic } from '../../../lib/api';
import { COLUMN_LABEL, COLUMN_ORDER } from './columns';
import { KanbanCard } from './KanbanCard';

/** Chave da faixa "sem épico" — órfãs (parentNumber null). SPEC-024. */
export const NO_EPIC_KEY = 'none';

/** Id do droppable de uma célula: `<epicKey>:<column>`. O onDragEnd extrai a coluna. */
export function cellDropId(epicKey: string, column: BoardColumn): string {
  return `${epicKey}:${column}`;
}

/** Coluna de um dropId de célula (`epicKey:column` → column). */
export function columnFromDropId(id: string): BoardColumn {
  return id.slice(id.indexOf(':') + 1) as BoardColumn;
}

interface CellProps {
  epicKey: string;
  column: BoardColumn;
  columnLabel: string;
  cards: BoardCard[];
  pendingNumbers: Set<number>;
  collapsed?: boolean;
  /** Toggle do colapso da coluna (global) — clicar no trilho fino expande. */
  onToggleCollapse?: () => void;
  onEdit?: (card: BoardCard) => void;
  /** `false` ⇒ cards abrem mas não arrastam (viewer — SPEC-030). */
  draggable?: boolean;
}

/** Uma célula da grade (faixa × coluna): área de drop + cards sortáveis daquela faixa. */
const SwimlaneCell = memo(function SwimlaneCell({
  epicKey,
  column,
  columnLabel,
  cards,
  pendingNumbers,
  collapsed,
  onToggleCollapse,
  onEdit,
  draggable,
}: CellProps) {
  const { setNodeRef, isOver } = useDroppable({ id: cellDropId(epicKey, column) });
  const sortableItems = useMemo(() => cards.map((c) => c.number), [cards]);

  // Coluna colapsada (Finalizado/Descartado): trilho fino, clicável para
  // expandir a coluna inteira (o colapso é global — o controle principal vive no
  // cabeçalho sticky do topo; aqui é só um atalho). Sem rótulo/seta repetidos por
  // faixa — o slot fino só mostra o contador da célula.
  if (collapsed) {
    return (
      <button
        ref={setNodeRef}
        onClick={onToggleCollapse}
        title={`Expandir ${columnLabel}`}
        className={
          'flex w-[34px] shrink-0 items-center justify-center rounded-[14px] border py-2 text-faint transition-colors duration-150 hover:border-hoverb hover:text-text ' +
          (isOver ? 'border-accent-border bg-card' : 'border-border bg-colbg')
        }
      >
        <span className="font-mono text-[9px] tabular-nums">{cards.length}</span>
      </button>
    );
  }

  return (
    <div
      ref={setNodeRef}
      className={
        'flex w-72 shrink-0 flex-col gap-2 rounded-[14px] border p-2 transition-colors duration-150 [contain:layout_paint] ' +
        (isOver ? 'border-accent-border bg-card' : 'border-border bg-colbg')
      }
    >
      <SortableContext
        items={sortableItems}
        strategy={verticalListSortingStrategy}
      >
        {cards.map((card) => (
          <KanbanCard
            key={card.number}
            card={card}
            pending={pendingNumbers.has(card.number)}
            onEdit={onEdit}
            draggable={draggable}
          />
        ))}
      </SortableContext>
      {cards.length === 0 && (
        <p className="flex flex-1 items-center justify-center rounded-[10px] border border-dashed border-border3 py-4 text-center font-mono text-[10px] text-faint">
          vazio
        </p>
      )}
    </div>
  );
});

interface Props {
  /** Épico da faixa, ou null para a faixa "sem épico". */
  epic: BoardEpic | null;
  /** Cards desta faixa, já agrupados por coluna. */
  cardsByColumn: Map<BoardColumn, BoardCard[]>;
  pendingNumbers: Set<number>;
  /** Colunas colapsadas (Finalizado/Descartado) — trilho fino, compartilhado por todas as faixas. */
  collapsedColumns: Set<BoardColumn>;
  /** Alterna o colapso de uma coluna (global ao board). */
  onToggleColumn: (column: BoardColumn) => void;
  onEdit?: (card: BoardCard) => void;
  /** `false` ⇒ cards abrem mas não arrastam (viewer — SPEC-030). */
  draggable?: boolean;
}

/**
 * Faixa (swimlane) da SPEC-024: cabeçalho do épico + grade de células, uma por
 * coluna, atravessando o board. O épico é faixa, não card — não tem coluna e não
 * é arrastável; só as fatias-filhas andam (drag inalterado). Colapso da faixa é
 * local; o das colunas vem de cima (compartilhado entre faixas).
 */
export const KanbanSwimlane = memo(function KanbanSwimlane({
  epic,
  cardsByColumn,
  pendingNumbers,
  collapsedColumns,
  onToggleColumn,
  onEdit,
  draggable,
}: Props) {
  const [laneCollapsed, setLaneCollapsed] = useState(false);
  const title = epic ? epic.title : 'Sem épico';
  const epicKey = epic ? String(epic.number) : NO_EPIC_KEY;

  return (
    <div className="flex shrink-0 flex-col">
      {/* Cabeçalho da faixa: seta de colapso + título + (épico) contagem
          fechadas/total. Sem barra de progresso, sem rótulo de coluna (§SPEC-024). */}
      <button
        onClick={() => setLaneCollapsed((c) => !c)}
        className="mb-2 flex items-center gap-2 px-1 text-left"
      >
        <svg
          aria-hidden
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={'shrink-0 text-faint transition-transform ' + (laneCollapsed ? '-rotate-90' : '')}
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
        <span className="truncate text-[12px] font-semibold text-text">{title}</span>
        {epic && (
          <span className="shrink-0 rounded-full border border-border2 px-1.5 py-0.5 font-mono text-[9px] tabular-nums text-faint">
            {epic.closedChildren}/{epic.totalChildren}
          </span>
        )}
        {epic && <span className="shrink-0 font-mono text-[9px] text-dim">#{epic.number}</span>}
      </button>

      {!laneCollapsed && (
        <div className="flex gap-3">
          {COLUMN_ORDER.map((column) => (
            <SwimlaneCell
              key={column}
              epicKey={epicKey}
              column={column}
              columnLabel={COLUMN_LABEL[column]}
              cards={cardsByColumn.get(column) ?? []}
              pendingNumbers={pendingNumbers}
              collapsed={collapsedColumns.has(column)}
              onToggleCollapse={() => onToggleColumn(column)}
              onEdit={onEdit}
              draggable={draggable}
            />
          ))}
        </div>
      )}
    </div>
  );
});
