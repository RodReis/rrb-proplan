import {
  closestCorners,
  DndContext,
  DragEndEvent,
  DragOverlay,
  DragStartEvent,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { api, BoardCard, BoardColumn, BoardView } from '../../../lib/api';
import { COLUMN_LABEL, COLUMN_ORDER } from './columns';
import { KanbanCardPreview } from './KanbanCard';
import { KanbanColumn } from './KanbanColumn';
import { columnFromDropId, KanbanSwimlane, NO_EPIC_KEY } from './KanbanSwimlane';
import { EditCardPopover } from './EditCardPopover';
import { BootstrapDialog } from './BootstrapDialog';
import { ImportBanner } from './ImportBanner';
import { useBoardMutation } from './useBoardMutation';

interface Props {
  projectId: string;
  syncNonce: number;
  /** Papel no tenant (SPEC-022). viewer → board somente leitura. */
  role: 'owner' | 'member' | 'viewer';
}

type State =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; board: BoardView };

export function KanbanTab({ projectId, syncNonce, role }: Props) {
  const [state, setState] = useState<State>({ status: 'loading' });
  const [activeCard, setActiveCard] = useState<BoardCard | null>(null);
  const [editing, setEditing] = useState<BoardCard | null>(null);
  // Finalizado e Descartado nascem colapsados (histórico, não polui o board).
  // Finalizado nasce ABERTO (decisão do PI): entregas aceitas ficam à vista.
  // Só Descartado nasce colapsado — é o que raramente se olha.
  const [collapsed, setCollapsed] = useState<Set<BoardColumn>>(
    new Set<BoardColumn>(['discarded']),
  );
  const [bootstrapOpen, setBootstrapOpen] = useState(false);

  const toggleCollapse = useCallback((col: BoardColumn) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      next.has(col) ? next.delete(col) : next.add(col);
      return next;
    });
  }, []);
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
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
  );

  const readyBoard = state.status === 'ready' ? state.board : null;

  const flatCardsByColumn = useMemo(() => {
    if (!readyBoard) return new Map<BoardColumn, BoardCard[]>();
    return new Map(readyBoard.columns.map((c) => [c.column, c.cards]));
  }, [readyBoard]);

  const swimlanes = useMemo(() => {
    return readyBoard ? orderedSwimlanes(readyBoard) : [];
  }, [readyBoard]);

  function onDragStart(e: DragStartEvent) {
    if (state.status !== 'ready') return;
    setActiveCard(findCard(state.board, Number(e.active.id)) ?? null);
  }

  async function onDragEnd(e: DragEndEvent) {
    setActiveCard(null);
    if (state.status !== 'ready' || !e.over) return;
    const number = Number(e.active.id);
    // `over.id` identifica o destino. Solto SOBRE um card → a coluna sai do
    // `data.card.column` do alvo. Solto numa área de drop → o id é a coluna nua
    // (board plano) ou `epicKey:column` (swimlane) — `columnFromDropId` devolve a
    // coluna em ambos (sem `:`, retorna a string inteira). O épico do destino é
    // ignorado: arrastar muda a coluna, nunca o pai (SPEC-024, leitura apenas).
    const overCard = e.over.data.current?.card as BoardCard | undefined;
    const toColumn = overCard
      ? overCard.column
      : columnFromDropId(String(e.over.id));
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

  const createCard = useCallback(
    async (column: BoardColumn, title: string) => {
      const ok = await mutate({ type: 'create_card', title, column }, null);
      if (!ok) toast.error('Não foi possível criar o card.');
      else {
        toast.success('Card criado.');
        flashSaving();
      }
    },
    [flashSaving, mutate],
  );

  if (state.status === 'loading') return <BoardSkeleton />;
  if (state.status === 'error') {
    return (
      <div className="m-8 rounded-md border border-error/30 bg-error/5 p-4 text-sm text-error">
        Falha ao carregar o board: {state.message}
      </div>
    );
  }

  const board = state.board;

  // viewer não escreve no board (SPEC-022): esconde os controles de criar/
  // editar/arrastar. A API também recusa (403) — defesa em profundidade. Modo
  // não-active já era read-only por outra razão; viewer soma a isso.
  const readOnly = role === 'viewer' || board.mode !== 'active';

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
    <div className="relative flex h-full flex-col overflow-hidden">
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
        collisionDetection={closestCorners}
        sensors={readOnly ? [] : sensors}
        onDragStart={readOnly ? undefined : onDragStart}
        onDragEnd={readOnly ? undefined : onDragEnd}
      >
        {board.epics.length === 0 ? (
          // Sem épico → board plano idêntico ao atual (SPEC-024: nenhuma
          // regressão em repos sem sub-issues).
          <div className="flex min-h-0 flex-1 gap-3 overflow-x-auto p-6">
            {COLUMN_ORDER.map((column) => (
              <KanbanColumn
                key={column}
                column={column}
                cards={cardsByColumn(flatCardsByColumn, column)}
                pendingNumbers={pending}
                collapsed={collapsed.has(column)}
                onToggleColumn={
                  column === 'finalized' || column === 'discarded'
                    ? toggleCollapse
                    : undefined
                }
                onEdit={readOnly ? undefined : setEditing}
                onCreate={
                  !readOnly &&
                  (column === 'backlog' || column === 'todo' || column === 'doing')
                    ? createCard
                    : undefined
                }
              />
            ))}
          </div>
        ) : (
          // Swimlanes (SPEC-024): faixa por épico + faixa "sem épico". Cabeçalho
          // de coluna uma vez no topo (sticky, para o toggle de colapso ficar
          // sempre visível ao rolar); cada faixa é uma grade de células.
          <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-auto p-6">
            <div className="sticky top-0 z-10 flex shrink-0 gap-3 bg-bg pb-2 pl-1">
              {COLUMN_ORDER.map((column) => {
                const isCol = collapsed.has(column);
                const canCollapse = column === 'finalized' || column === 'discarded';
                return (
                  <button
                    key={column}
                    onClick={canCollapse ? () => toggleCollapse(column) : undefined}
                    disabled={!canCollapse}
                    title={
                      canCollapse
                        ? `${isCol ? 'Expandir' : 'Recolher'} ${COLUMN_LABEL[column]}`
                        : undefined
                    }
                    className={
                      'flex shrink-0 items-center gap-1 truncate text-left font-mono text-[9px] uppercase tracking-[0.14em] text-faint disabled:cursor-default ' +
                      (canCollapse ? 'hover:text-text ' : '') +
                      (isCol ? 'w-[34px] justify-center' : 'w-72')
                    }
                  >
                    {canCollapse && (
                      <svg
                        aria-hidden
                        width="11"
                        height="11"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        className="shrink-0"
                      >
                        <path d={isCol ? 'm9 18 6-6-6-6' : 'm15 18-6-6 6-6'} />
                      </svg>
                    )}
                    {!isCol && <span className="truncate">{COLUMN_LABEL[column]}</span>}
                  </button>
                );
              })}
            </div>
            {swimlanes.map(({ epic, cardsByColumn: grid }) => (
              <KanbanSwimlane
                key={epic ? epic.number : NO_EPIC_KEY}
                epic={epic}
                cardsByColumn={grid}
                pendingNumbers={pending}
                collapsedColumns={collapsed}
                onToggleColumn={toggleCollapse}
                onEdit={readOnly ? undefined : setEditing}
              />
            ))}
          </div>
        )}

        <DragOverlay>
          {activeCard && (
            <div className="rotate-2">
              <KanbanCardPreview card={activeCard} />
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

/**
 * Monta as faixas da swimlane (SPEC-024): uma por épico + a "sem épico" por
 * último. Cada faixa traz seus cards já agrupados por coluna. Ordem dos épicos
 * derivada do número (crescente); só filhas de um épico presente entram na sua
 * faixa — filhas cujo pai fechou (não está em `epics`) caem em "sem épico".
 */
export function orderedSwimlanes(board: BoardView): {
  epic: BoardView['epics'][number] | null;
  cardsByColumn: Map<BoardColumn, BoardCard[]>;
}[] {
  const epicNumbers = new Set(board.epics.map((e) => e.number));
  const emptyGrid = () => new Map(COLUMN_ORDER.map((c) => [c, [] as BoardCard[]]));

  const byEpic = new Map<number | null, Map<BoardColumn, BoardCard[]>>();
  for (const e of board.epics) byEpic.set(e.number, emptyGrid());
  byEpic.set(null, emptyGrid());

  for (const col of board.columns) {
    for (const card of col.cards) {
      // Filha de épico presente vai para a faixa dele; senão "sem épico".
      const key =
        card.parentNumber != null && epicNumbers.has(card.parentNumber)
          ? card.parentNumber
          : null;
      byEpic.get(key)!.get(col.column)!.push(card);
    }
  }

  const lanes = [...board.epics]
    .sort((a, b) => a.number - b.number)
    .map((epic) => ({ epic, cardsByColumn: byEpic.get(epic.number)! }));
  lanes.push({ epic: null as never, cardsByColumn: byEpic.get(null)! });
  return lanes;
}

function cardsByColumn(
  columns: Map<BoardColumn, BoardCard[]>,
  column: BoardColumn,
): BoardCard[] {
  return columns.get(column) ?? [];
}

function findCard(board: BoardView, number: number): BoardCard | undefined {
  for (const col of board.columns) {
    const card = col.cards.find((c) => c.number === number);
    if (card) return card;
  }
  return undefined;
}

/** Move um card de coluna no estado local (otimista). */
function moveCardLocal(
  board: BoardView,
  number: number,
  toColumn: BoardColumn,
): BoardView {
  let card: BoardCard | undefined;
  let fromColumn: BoardColumn | null = null;

  for (const col of board.columns) {
    card = col.cards.find((c) => c.number === number);
    if (card) {
      fromColumn = col.column;
      break;
    }
  }

  if (!card || !fromColumn) return board;
  const moved = { ...card, column: toColumn };
  return {
    ...board,
    columns: board.columns.map((col) => {
      if (col.column === toColumn) {
        return {
          ...col,
          cards: [moved, ...col.cards.filter((c) => c.number !== number)],
        };
      }
      if (col.column === fromColumn) {
        return { ...col, cards: col.cards.filter((c) => c.number !== number) };
      }
      return col;
    }),
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
