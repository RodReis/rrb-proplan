import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import {
  DndContext,
  DragOverlay,
  type DragStartEvent,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import { toast } from 'sonner';
import {
  getClientBoard,
  transitionClientProject,
  type FunnelCard,
  type FunnelBoardColumn,
  type FunnelColumn,
} from '../../lib/api';
import { ClientsShell } from './ClientsShell';
import {
  COLUMN_LABELS,
  COLUMN_TINT,
  STATE_LABELS,
  applyConfirmedState,
  cardSubtitle,
  columnOf,
  countCards,
  initials,
  moveCard,
} from './boardView';
import './FunnelPage.css';

type State =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; columns: FunnelBoardColumn[] };

const cardDateFormatter = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit',
  month: '2-digit',
});

/**
 * Funil de clientes (SPEC-029) — `/t/:tenant/clients/funil`.
 *
 * Drag-and-drop com **atualização otimista e rollback**: o card se move na
 * hora, e volta à posição anterior se o servidor recusar a transição (422). A
 * validação é do servidor — a UI nunca decide o que é transição legítima; ela
 * só mostra o resultado e desfaz quando erra.
 */
export function FunnelPage({ canWrite }: { canWrite: boolean }) {
  const { tenant = '' } = useParams();
  const [state, setState] = useState<State>({ status: 'loading' });
  const [query, setQuery] = useState('');
  const [activeCard, setActiveCard] = useState<FunnelCard | null>(null);
  const [activeTint, setActiveTint] = useState<string | null>(null);

  // Ponteiro com distância mínima: sem isto, um clique simples no card viraria
  // um drag de 0px e a UI dispararia transição sem o usuário ter arrastado.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  );

  const load = useCallback(async (q: string) => {
    try {
      const board = await getClientBoard(q);
      setState({ status: 'ready', columns: board.columns });
    } catch (err) {
      setState({
        status: 'error',
        message: err instanceof Error ? err.message : 'falha ao carregar o funil',
      });
    }
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => void load(query), 250);
    return () => clearTimeout(timer);
  }, [query, load]);

  function handleDragStart(event: DragStartEvent) {
    if (state.status !== 'ready') return;
    const cardId = String(event.active.id);
    const sourceColumn = state.columns.find((column) =>
      column.cards.some((card) => card.id === cardId),
    );
    setActiveTint(sourceColumn ? COLUMN_TINT[sourceColumn.column] : null);
    setActiveCard(sourceColumn?.cards.find((card) => card.id === cardId) ?? null);
  }

  async function handleDragEnd(event: DragEndEvent) {
    setActiveCard(null);
    setActiveTint(null);
    if (state.status !== 'ready') return;

    const cardId = String(event.active.id);
    const target = event.over?.id as FunnelColumn | undefined;
    if (!target) return;

    const optimistic = moveCard(state.columns, cardId, target);
    // Identidade preservada = nada mudou (mesma coluna ou card inexistente).
    // Sem esta guarda, soltar o card onde ele já estava dispararia request.
    if (optimistic === state.columns) return;

    const previous = state.columns;
    const previousColumn = columnOf(previous, cardId);
    setState({ status: 'ready', columns: optimistic });

    try {
      const updated = await transitionClientProject(cardId, { column: target });
      // O servidor responde o ESTADO interno; a UI moveu por COLUNA. Sem isto o
      // card ficaria com o rótulo antigo até o próximo refetch.
      setState({
        status: 'ready',
        columns: applyConfirmedState(optimistic, cardId, updated.state),
      });
    } catch (err) {
      // Rollback observável — o critério de aceite da spec.
      setState({ status: 'ready', columns: previous });
      const invalid = err instanceof Error && err.message.includes('422');
      toast.error(
        invalid
          ? `Transição não permitida: ${COLUMN_LABELS[previousColumn!]} → ${COLUMN_LABELS[target]}`
          : 'Não foi possível mover o card',
      );
    }
  }

  return (
    <ClientsShell
      tenant={tenant}
      title="Funil"
      subtitle="Do primeiro contato à entrega, com cada projeto no estado comercial atual."
    >
      <div className="funnel-toolbar">
        <label className="funnel-search">
          <span className="sr-only">Buscar no funil</span>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar por cliente, empresa ou projeto"
            aria-label="Buscar no funil"
          />
        </label>

        {state.status === 'ready' && (
          <div className="funnel-summary" aria-label="Resumo do funil">
            <span>
              {state.columns.reduce((total, column) => total + countCards(column), 0)} cards
            </span>
            {!canWrite && <span>Somente leitura</span>}
          </div>
        )}
      </div>

      {state.status === 'loading' && <BoardSkeleton />}
      {state.status === 'error' && (
        <div className="funnel-alert" role="alert">
          <strong>Falha ao carregar o funil</strong>
          <span>{state.message}</span>
        </div>
      )}

      {state.status === 'ready' && (
        <DndContext
          sensors={canWrite ? sensors : []}
          onDragStart={canWrite ? handleDragStart : undefined}
          onDragCancel={() => {
            setActiveCard(null);
            setActiveTint(null);
          }}
          onDragEnd={canWrite ? (e) => void handleDragEnd(e) : undefined}
        >
          <div className="funnel-board">
            {state.columns.map((column) => (
              <Column key={column.column} column={column} draggable={canWrite} />
            ))}
          </div>

          <DragOverlay>
            {activeCard && (
              <div className="funnel-drag-overlay">
                <Card
                  card={activeCard}
                  draggable={false}
                  overlay
                  tint={activeTint ?? undefined}
                />
              </div>
            )}
          </DragOverlay>
        </DndContext>
      )}
    </ClientsShell>
  );
}

function Column({ column, draggable }: { column: FunnelBoardColumn; draggable: boolean }) {
  const { setNodeRef, isOver } = useDroppable({ id: column.column });
  const tintStyle = { ['--funnel-tint' as string]: COLUMN_TINT[column.column] };

  return (
    <section
      ref={setNodeRef}
      aria-label={COLUMN_LABELS[column.column]}
      className={isOver ? 'funnel-column funnel-column--over' : 'funnel-column'}
      style={tintStyle}
    >
      <header className="funnel-column__header">
        <span aria-hidden className="funnel-column__dot" />
        <span className="funnel-column__label">{COLUMN_LABELS[column.column]}</span>
        <span className="funnel-column__count">{column.cards.length}</span>
      </header>

      <div className="funnel-column__cards">
        {column.cards.map((card) => (
          <Card key={card.id} card={card} draggable={draggable} />
        ))}
        {column.cards.length === 0 && (
          <div className="funnel-empty-column">
            <span>Sem cards nesta etapa</span>
            <small>{draggable ? 'Solte um projeto aqui.' : 'Nenhum projeto encontrado.'}</small>
          </div>
        )}
      </div>
    </section>
  );
}

function Card({
  card,
  draggable,
  overlay = false,
  tint,
}: {
  card: FunnelCard;
  draggable: boolean;
  overlay?: boolean;
  tint?: string;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: card.id,
    disabled: !draggable,
  });

  return (
    <article
      ref={setNodeRef}
      {...(draggable ? listeners : {})}
      {...attributes}
      className={`funnel-card ${isDragging ? 'funnel-card--dragging' : ''} ${
        overlay ? 'funnel-card--overlay' : ''
      }`}
      style={{
        ...(tint ? { ['--funnel-tint' as string]: tint } : {}),
        cursor: draggable ? 'grab' : 'default',
        transform: transform
          ? `translate3d(${transform.x}px, ${transform.y}px, 0)`
          : undefined,
      }}
    >
      <div className="funnel-card__top">
        <span aria-hidden className="funnel-card__avatar">
          {initials(card.client.name)}
        </span>
        <div className="funnel-card__identity">
          <h2>{card.title}</h2>
          <p>{cardSubtitle(card)}</p>
        </div>
      </div>
      {card.description && <p className="funnel-card__description">{card.description}</p>}
      <footer className="funnel-card__footer">
        <span className="funnel-card__state">{STATE_LABELS[card.state]}</span>
        <span className="funnel-card__date">{formatCardDate(card.updatedAt)}</span>
      </footer>
    </article>
  );
}

function formatCardDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '--/--';

  return cardDateFormatter.format(date);
}

function BoardSkeleton() {
  return (
    <div className="funnel-board" aria-label="Carregando funil">
      {Array.from({ length: 4 }).map((_, index) => (
        <section className="funnel-column funnel-column--skeleton" key={index}>
          <div className="funnel-skeleton funnel-skeleton--header" />
          <div className="funnel-skeleton funnel-skeleton--card" />
          <div className="funnel-skeleton funnel-skeleton--card funnel-skeleton--short" />
        </section>
      ))}
    </div>
  );
}
