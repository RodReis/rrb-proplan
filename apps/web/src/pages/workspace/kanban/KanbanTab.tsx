import {
  DndContext,
  DragEndEvent,
  DragOverlay,
  DragStartEvent,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { api, BoardCard, BoardColumn, BoardView } from '../../../lib/api';
import { COLUMN_ORDER } from './columns';
import { KanbanCard } from './KanbanCard';
import { KanbanColumn } from './KanbanColumn';
import { EditCardPopover } from './EditCardPopover';
import { BootstrapDialog } from './BootstrapDialog';
import { ImportBanner } from './ImportBanner';
import { useBoardMutation } from './useBoardMutation';

interface Props {
  projectId: string;
  syncNonce: number;
}

type State =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; board: BoardView };

export function KanbanTab({ projectId, syncNonce }: Props) {
  const [state, setState] = useState<State>({ status: 'loading' });
  const [activeCard, setActiveCard] = useState<BoardCard | null>(null);
  const [editing, setEditing] = useState<BoardCard | null>(null);
  const [collapsed, setCollapsed] = useState(true); // Descartado colapsado
  const [bootstrapOpen, setBootstrapOpen] = useState(false);
  const [savingRepo, setSavingRepo] = useState(false);

  // Indicador global discreto: após uma mutação, a projeção .proplan/STATUS.md
  // roda em background (debounce ~4s). Mostra "salvando no repo…" por ~5s —
  // nunca por card (a borda pulsante já parou em applied). SPEC-005.
  const flashSaving = useCallback(() => {
    setSavingRepo(true);
    const t = setTimeout(() => setSavingRepo(false), 5000);
    return () => clearTimeout(t);
  }, []);

  const load = useCallback(() => {
    api
      .board(projectId)
      .then((board) => setState({ status: 'ready', board }))
      .catch((err) => setState({ status: 'error', message: String(err) }));
  }, [projectId]);

  useEffect(load, [load, syncNonce]);

  const { pending, mutate } = useBoardMutation(projectId, load);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  );

  function cardsByColumn(board: BoardView, column: BoardColumn): BoardCard[] {
    return board.columns.find((c) => c.column === column)?.cards ?? [];
  }

  function findCard(board: BoardView, number: number): BoardCard | undefined {
    return board.columns.flatMap((c) => c.cards).find((c) => c.number === number);
  }

  function onDragStart(e: DragStartEvent) {
    if (state.status !== 'ready') return;
    setActiveCard(findCard(state.board, Number(e.active.id)) ?? null);
  }

  async function onDragEnd(e: DragEndEvent) {
    setActiveCard(null);
    if (state.status !== 'ready' || !e.over) return;
    const number = Number(e.active.id);
    const toColumn = e.over.id as BoardColumn;
    const card = findCard(state.board, number);
    if (!card || card.column === toColumn) return;

    // Otimista: move o card na UI já; reverte no erro.
    const snapshot = state.board;
    setState({ status: 'ready', board: moveCardLocal(snapshot, number, toColumn) });

    const ok = await mutate({ type: 'move_column', number, toColumn }, number);
    if (!ok) {
      setState({ status: 'ready', board: snapshot });
      toast.error(`Não foi possível mover #${number}. Revertido.`);
    } else {
      flashSaving();
    }
  }

  async function createCard(column: BoardColumn, title: string) {
    const ok = await mutate({ type: 'create_card', title, column }, null);
    if (!ok) toast.error('Não foi possível criar o card.');
    else {
      toast.success('Card criado.');
      flashSaving();
    }
  }

  if (state.status === 'loading') return <BoardSkeleton />;
  if (state.status === 'error') {
    return (
      <div className="m-8 rounded-md border border-error/30 bg-error/5 p-4 text-sm text-error">
        Falha ao carregar o board: {state.message}
      </div>
    );
  }

  const board = state.board;

  if (board.mode === 'no-installation') {
    return (
      <Banner tone="warning">
        O GitHub App não está instalado neste repositório — board somente
        leitura. Reinstale para gerir cards.
      </Banner>
    );
  }
  if (board.mode === 'degraded') {
    return (
      <Banner tone="warning">
        Issues desabilitada neste repositório — board somente leitura a partir do
        docs/STATUS.md. Habilite Issues no GitHub para gerir cards.
      </Banner>
    );
  }

  return (
    <div className="relative flex h-full flex-col">
      {savingRepo && (
        <div className="pointer-events-none absolute right-6 top-3 z-20 flex items-center gap-1.5 rounded-full border border-border bg-surface px-2.5 py-1 text-[11px] text-text-muted shadow-sm">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-brand" />
          salvando no repo…
        </div>
      )}

      {board.needsIssueImport && (
        <ImportBanner
          projectId={projectId}
          onImported={load}
          onBootstrap={() => setBootstrapOpen(true)}
        />
      )}

      <DndContext
        sensors={sensors}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
      >
        <div className="flex flex-1 gap-3 overflow-x-auto p-6">
          {COLUMN_ORDER.map((column) => (
            <KanbanColumn
              key={column}
              column={column}
              cards={cardsByColumn(board, column)}
              pendingNumbers={pending}
              collapsed={column === 'discarded' ? collapsed : false}
              onToggleCollapse={
                column === 'discarded' ? () => setCollapsed((c) => !c) : undefined
              }
              onEdit={setEditing}
              onCreate={
                column === 'backlog' || column === 'todo' || column === 'doing'
                  ? (title) => void createCard(column, title)
                  : undefined
              }
            />
          ))}
        </div>

        <DragOverlay>
          {activeCard && (
            <div className="rotate-2">
              <KanbanCard card={activeCard} onEdit={() => {}} />
            </div>
          )}
        </DragOverlay>
      </DndContext>

      {editing && (
        <EditCardPopover
          card={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            load();
          }}
          projectId={projectId}
          mutate={mutate}
        />
      )}

      {bootstrapOpen && (
        <BootstrapDialog
          projectId={projectId}
          onClose={() => setBootstrapOpen(false)}
          onCreated={() => {
            setBootstrapOpen(false);
            load();
          }}
        />
      )}
    </div>
  );
}

/** Move um card de coluna no estado local (otimista). */
function moveCardLocal(
  board: BoardView,
  number: number,
  toColumn: BoardColumn,
): BoardView {
  const card = board.columns.flatMap((c) => c.cards).find((c) => c.number === number);
  if (!card) return board;
  const moved = { ...card, column: toColumn };
  return {
    ...board,
    columns: board.columns.map((col) => ({
      ...col,
      cards:
        col.column === toColumn
          ? [moved, ...col.cards.filter((c) => c.number !== number)]
          : col.cards.filter((c) => c.number !== number),
    })),
  };
}

function Banner({ tone, children }: { tone: 'warning'; children: React.ReactNode }) {
  return (
    <div className="m-8 rounded-md border border-warning/30 bg-warning/5 p-4 text-sm text-text">
      {children}
    </div>
  );
}

function BoardSkeleton() {
  return (
    <div className="flex gap-3 p-6">
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="w-72 shrink-0">
          <div className="mb-2 h-5 w-24 animate-pulse rounded bg-surface-hover" />
          <div className="h-64 animate-pulse rounded-md border border-border bg-surface-hover" />
        </div>
      ))}
    </div>
  );
}
