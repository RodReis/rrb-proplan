import { useDroppable } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { useState } from 'react';
import { BoardCard, BoardColumn } from '../../../lib/api';
import { stageColor, stageOf } from '../../../stageTint';
import { useTheme } from '../../../theme';
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
  const { theme } = useTheme();
  const { setNodeRef, isOver } = useDroppable({ id: column });
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState('');

  const stage = stageOf(column);
  // Descartado é decisão, não etapa (§6) — sem cor própria, neutro.
  const dotColor = stage ? stageColor(theme, stage) : 'var(--dim)';

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
        title={`Expandir ${COLUMN_LABEL[column]}`}
        className="flex h-full w-[34px] shrink-0 flex-col items-center gap-2 rounded-[14px] border border-border bg-colbg py-3 text-faint transition-colors duration-150 hover:border-hoverb hover:text-text"
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
        >
          <path d="m15 18-6-6 6-6" />
        </svg>
        <span className="font-mono text-[9px] tabular-nums">{cards.length}</span>
        <span
          className="mt-1 font-mono text-[9px] uppercase tracking-[0.14em] [writing-mode:vertical-rl]"
          style={{ transform: 'rotate(180deg)' }}
        >
          {COLUMN_LABEL[column]}
        </span>
      </button>
    );
  }

  return (
    <div className="flex h-full w-72 shrink-0 flex-col">
      {/* Header da coluna (§6): ponto na cor da etapa + rótulo Mono + contador
          em pílula da mesma cor a ~14%. A coluna em si é neutra (--colbg): a
          cor da etapa vive no ponto, no contador e na tinta do card. */}
      <div className="mb-2 flex items-center justify-between gap-2 px-1">
        <button
          onClick={onToggleCollapse}
          disabled={!onToggleCollapse}
          className="flex min-w-0 items-center gap-2 disabled:cursor-default"
        >
          <span
            aria-hidden
            className="h-2 w-2 shrink-0 rounded-full"
            style={{ background: dotColor }}
          />
          <span className="truncate font-mono text-[9px] uppercase tracking-[0.14em] text-faint">
            {COLUMN_LABEL[column]}
          </span>
          <span
            className="shrink-0 rounded-full px-1.5 py-0.5 font-mono text-[9px] tabular-nums"
            style={{
              color: dotColor,
              background: `color-mix(in srgb, ${dotColor} 14%, transparent)`,
            }}
          >
            {cards.length}
          </span>
        </button>
        {canCreate && !creating && (
          <button
            onClick={() => setCreating(true)}
            title="Criar card"
            aria-label={`Criar card em ${COLUMN_LABEL[column]}`}
            className="shrink-0 text-faint transition-colors duration-150 hover:text-text"
          >
            +
          </button>
        )}
      </div>

      {!collapsed && (
        <div
          ref={setNodeRef}
          className={
            'flex min-h-[80px] flex-1 flex-col gap-2 overflow-y-auto rounded-[14px] border p-2 transition-colors duration-150 ' +
            // Coluna neutra --colbg (§6); drop target ganha borda de acento.
            (isOver ? 'border-accent-border bg-card' : 'border-border bg-colbg')
          }
        >
          {creating && (
            <div className="rounded-[10px] border border-accent-border bg-surface2 p-2">
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
                aria-label={`Título do novo card em ${COLUMN_LABEL[column]}`}
                // Placeholder em --muted, não --dimmer: é texto que se lê e
                // precisa de AA (--dimmer dá 2.85:1 aqui). O --dimmer serve a
                // ponto de estado e decoração, não a texto.
                className="w-full bg-transparent text-[12.5px] text-text outline-none placeholder:text-muted"
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

          {/* Coluna vazia: caixa tracejada com "vazio" (§6). A ausência é
              visível, não decorada — nem some, nem vira ilustração. */}
          {cards.length === 0 && !creating && (
            <p className="flex flex-1 items-center justify-center rounded-[10px] border border-dashed border-border3 py-6 text-center font-mono text-[10px] text-faint">
              vazio
            </p>
          )}
        </div>
      )}
    </div>
  );
}
