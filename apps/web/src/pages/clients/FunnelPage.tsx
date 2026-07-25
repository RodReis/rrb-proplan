import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import {
  DndContext,
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
  moveCard,
} from './boardView';

type State =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; columns: FunnelBoardColumn[] };

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

  async function handleDragEnd(event: DragEndEvent) {
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
      subtitle="Do primeiro contato à entrega. Arraste o card para avançar a etapa."
    >
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Buscar por cliente, empresa ou projeto"
        aria-label="Buscar no funil"
        style={{
          width: '100%',
          maxWidth: 380,
          marginBottom: 20,
          padding: '9px 12px',
          borderRadius: 8,
          border: '1px solid var(--border2)',
          background: 'var(--surface)',
          color: 'var(--text)',
          fontSize: 14,
        }}
      />

      {state.status === 'loading' && <p style={muted}>Carregando…</p>}
      {state.status === 'error' && (
        <p style={{ ...muted, color: 'var(--error)' }}>{state.message}</p>
      )}

      {state.status === 'ready' && (
        <DndContext sensors={sensors} onDragEnd={(e) => void handleDragEnd(e)}>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: `repeat(${state.columns.length}, minmax(210px, 1fr))`,
              gap: 12,
              alignItems: 'start',
              overflowX: 'auto',
            }}
          >
            {state.columns.map((column) => (
              <Column key={column.column} column={column} draggable={canWrite} />
            ))}
          </div>
        </DndContext>
      )}
    </ClientsShell>
  );
}

function Column({ column, draggable }: { column: FunnelBoardColumn; draggable: boolean }) {
  const { setNodeRef, isOver } = useDroppable({ id: column.column });

  return (
    <section
      ref={setNodeRef}
      aria-label={COLUMN_LABELS[column.column]}
      style={{
        borderRadius: 10,
        border: `1px solid ${isOver ? 'var(--hoverb)' : 'var(--border)'}`,
        background: 'var(--colbg)',
        padding: 10,
        minHeight: 180,
      }}
    >
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 7,
          padding: '2px 4px 12px',
        }}
      >
        <span
          aria-hidden
          style={{
            width: 7,
            height: 7,
            borderRadius: '50%',
            background: COLUMN_TINT[column.column],
          }}
        />
        <span
          style={{
            flex: 1,
            fontSize: 11,
            letterSpacing: '0.07em',
            color: 'var(--faint)',
            textTransform: 'uppercase',
          }}
        >
          {COLUMN_LABELS[column.column]}
        </span>
        <span style={{ fontSize: 12, color: 'var(--dim)' }}>{column.cards.length}</span>
      </header>

      <div style={{ display: 'grid', gap: 8 }}>
        {column.cards.map((card) => (
          <Card key={card.id} card={card} draggable={draggable} />
        ))}
      </div>
    </section>
  );
}

function Card({ card, draggable }: { card: FunnelCard; draggable: boolean }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: card.id,
    disabled: !draggable,
  });

  return (
    <article
      ref={setNodeRef}
      {...(draggable ? listeners : {})}
      {...attributes}
      style={{
        padding: '11px 12px',
        borderRadius: 9,
        border: '1px solid var(--border2)',
        background: 'var(--card)',
        cursor: draggable ? 'grab' : 'default',
        opacity: isDragging ? 0.5 : 1,
        transform: transform
          ? `translate3d(${transform.x}px, ${transform.y}px, 0)`
          : undefined,
      }}
    >
      <div style={{ color: 'var(--text)', fontSize: 14, fontWeight: 600 }}>
        {card.title}
      </div>
      <div style={{ color: 'var(--muted)', fontSize: 12, marginTop: 3 }}>
        {cardSubtitle(card)}
      </div>
      <span
        style={{
          display: 'inline-block',
          marginTop: 9,
          padding: '2px 7px',
          borderRadius: 5,
          fontSize: 10,
          letterSpacing: '0.05em',
          textTransform: 'uppercase',
          background: 'var(--surface2)',
          color: 'var(--body)',
        }}
      >
        {STATE_LABELS[card.state]}
      </span>
    </article>
  );
}

const muted = { color: 'var(--muted)', fontSize: 14 } as const;
