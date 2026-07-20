import { useDroppable } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { useState } from 'react';
import { BoardCard, BoardColumn, BoardEpic } from '../../../lib/api';
import { COLUMN_ORDER } from './columns';
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
  cards: BoardCard[];
  pendingNumbers: Set<number>;
  onEdit?: (card: BoardCard) => void;
}

/** Uma célula da grade (faixa × coluna): área de drop + cards sortáveis daquela faixa. */
function SwimlaneCell({ epicKey, column, cards, pendingNumbers, onEdit }: CellProps) {
  const { setNodeRef, isOver } = useDroppable({ id: cellDropId(epicKey, column) });
  return (
    <div
      ref={setNodeRef}
      className={
        'flex w-72 shrink-0 flex-col gap-2 rounded-[14px] border p-2 transition-colors duration-150 ' +
        (isOver ? 'border-accent-border bg-card' : 'border-border bg-colbg')
      }
    >
      <SortableContext
        items={cards.map((c) => c.number)}
        strategy={verticalListSortingStrategy}
      >
        {cards.map((card) => (
          <KanbanCard
            key={card.number}
            card={card}
            pending={pendingNumbers.has(card.number)}
            onEdit={onEdit}
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
}

interface Props {
  /** Épico da faixa, ou null para a faixa "sem épico". */
  epic: BoardEpic | null;
  /** Cards desta faixa, já agrupados por coluna. */
  cardsByColumn: Map<BoardColumn, BoardCard[]>;
  pendingNumbers: Set<number>;
  onEdit?: (card: BoardCard) => void;
}

/**
 * Faixa (swimlane) da SPEC-024: cabeçalho do épico + grade de células, uma por
 * coluna, atravessando o board. O épico é faixa, não card — não tem coluna e não
 * é arrastável; só as fatias-filhas andam (drag inalterado). Colapso é local.
 */
export function KanbanSwimlane({ epic, cardsByColumn, pendingNumbers, onEdit }: Props) {
  const [collapsed, setCollapsed] = useState(false);
  const title = epic ? epic.title : 'Sem épico';
  const epicKey = epic ? String(epic.number) : NO_EPIC_KEY;

  return (
    <div className="flex shrink-0 flex-col">
      {/* Cabeçalho da faixa: seta de colapso + título + (épico) contagem
          fechadas/total. Sem barra de progresso, sem rótulo de coluna (§SPEC-024). */}
      <button
        onClick={() => setCollapsed((c) => !c)}
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
          className={'shrink-0 text-faint transition-transform ' + (collapsed ? '-rotate-90' : '')}
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

      {!collapsed && (
        <div className="flex gap-3">
          {COLUMN_ORDER.map((column) => (
            <SwimlaneCell
              key={column}
              epicKey={epicKey}
              column={column}
              cards={cardsByColumn.get(column) ?? []}
              pendingNumbers={pendingNumbers}
              onEdit={onEdit}
            />
          ))}
        </div>
      )}
    </div>
  );
}
