import { useDroppable } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { useState } from 'react';
import { BoardCard, BoardColumn } from '../../../lib/api';
import { COLUMN_LABEL } from './columns';
import { KanbanCard } from './KanbanCard';

interface Props {
  column: BoardColumn;
  cards: BoardCard[];
  pendingNumbers: Set<number>;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
  onEdit: (card: BoardCard) => void;
  onCreate?: (title: string) => void;
}

/**
 * Uma coluna do board: área de drop (dnd-kit) + cards ordenados. Backlog/A Fazer/
 * Em Andamento permitem criar inline; Descartado é colapsável (DESIGN.md).
 */
export function KanbanColumn({
  column,
  cards,
  pendingNumbers,
  collapsed,
  onToggleCollapse,
  onEdit,
  onCreate,
}: Props) {
  const { setNodeRef, isOver } = useDroppable({ id: column });
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState('');

  const canCreate = !!onCreate && (column === 'backlog' || column === 'todo' || column === 'doing');

  function submitCreate() {
    const t = title.trim();
    if (t && onCreate) onCreate(t);
    setTitle('');
    setCreating(false);
  }

  // Colapsada: faixa fina com o título na vertical e o contador — não ocupa
  // uma coluna larga vazia (SPEC-005: Finalizado/Descartado colapsados).
  if (collapsed) {
    return (
      <button
        onClick={onToggleCollapse}
        className="flex h-full w-10 shrink-0 flex-col items-center gap-2 rounded-md border border-border bg-surface-hover py-3 text-text-muted transition-colors hover:text-brand"
      >
        <span className="text-xs">▸</span>
        <span className="rounded-full border border-border bg-surface px-1.5 text-[11px]">
          {cards.length}
        </span>
        <span
          className="mt-1 text-sm font-semibold [writing-mode:vertical-rl]"
          style={{ transform: 'rotate(180deg)' }}
        >
          {COLUMN_LABEL[column]}
        </span>
      </button>
    );
  }

  return (
    <div className="flex h-full w-72 shrink-0 flex-col">
      <div className="mb-2 flex items-center justify-between px-1">
        <button
          onClick={onToggleCollapse}
          disabled={!onToggleCollapse}
          className="flex items-center gap-1.5 text-sm font-semibold disabled:cursor-default"
        >
          {onToggleCollapse && <span className="text-text-muted">▾</span>}
          {COLUMN_LABEL[column]}
          <span className="rounded-full border border-border bg-surface px-1.5 text-[11px] font-normal text-text-muted">
            {cards.length}
          </span>
        </button>
        {canCreate && !creating && (
          <button
            onClick={() => setCreating(true)}
            title="Criar card"
            className="text-text-muted transition-colors hover:text-brand"
          >
            +
          </button>
        )}
      </div>

      {!collapsed && (
        <div
          ref={setNodeRef}
          className={
            'flex min-h-[80px] flex-1 flex-col gap-2 overflow-y-auto rounded-md border p-2 transition-colors ' +
            (isOver ? 'border-brand/40 bg-brand/5' : 'border-border bg-surface-hover')
          }
        >
          {creating && (
            <div className="rounded-md border border-brand/40 bg-surface p-2">
              <input
                autoFocus
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') submitCreate();
                  if (e.key === 'Escape') {
                    setCreating(false);
                    setTitle('');
                  }
                }}
                onBlur={submitCreate}
                placeholder="Título do card…"
                className="w-full bg-transparent text-[13px] outline-none"
              />
            </div>
          )}

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

          {cards.length === 0 && !creating && (
            <p className="px-1 py-2 text-center text-[11px] text-text-muted/60">
              vazio
            </p>
          )}
        </div>
      )}
    </div>
  );
}
