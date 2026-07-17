import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { BoardCard } from '../../../lib/api';
import { priorityColor, stageCardStyle, stageOf } from '../../../stageTint';
import { useTheme } from '../../../theme';
import { PRIORITY_CHIP, PRIORITY_LABEL } from './columns';

interface Props {
  card: BoardCard;
  /** Mutação em voo → borda pulsante até a API confirmar (applied). */
  pending?: boolean;
  onEdit: (card: BoardCard) => void;
}

/**
 * `dd/MM/aaaa 'às' hh:mm` (pt-BR, 24h). ISO inválido/ausente → null — o card
 * fica sem carimbo em vez de exibir "Invalid Date".
 *
 * `timeZone` existe para o teste fixar o fuso; em produção fica de fora e o
 * horário sai no relógio do usuário, que é o que ele espera ver.
 */
export function formatStamp(iso: string | null, timeZone?: string): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const data = d.toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    timeZone,
  });
  // hourCycle h23 → 00:xx; `hour12: false` sozinho produz 24:xx à meia-noite.
  const hora = d.toLocaleTimeString('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZone,
  });
  return `${data} às ${hora}`;
}

/**
 * O carimbo do card: cada coluna mostra o fato que importa nela (decisão do PI
 * em 2026-07-16). Aberto → quando nasceu ("aberta desde"); encerrado → quando
 * foi aceito/descartado. Um carimbo por card, sempre — o que muda é qual.
 *
 * Finalizado/Descartado sem `closedAt` cai de volta na criação: o card não pode
 * ficar mudo, e a data de nascimento continua verdadeira. Nunca inventa.
 */
function stampOf(card: BoardCard): { label: string; value: string } | null {
  const encerrado = card.column === 'finalized' || card.column === 'discarded';
  const fechado = encerrado ? formatStamp(card.closedAt) : null;
  if (fechado) {
    return { label: card.column === 'discarded' ? 'descartado em' : 'finalizado em', value: fechado };
  }
  const criado = formatStamp(card.createdAt);
  return criado ? { label: 'aberta em', value: criado } : null;
}

/**
 * Card do Kanban (variação B do DESIGN.md): avatar do assignee + faixa de
 * prioridade semântica à esquerda + chip de prioridade + número da issue + link.
 * Arrastável (dnd-kit). Sem cor decorativa — só sinal semântico (ADR do DESIGN).
 */
export function KanbanCard({ card, pending, onEdit }: Props) {
  const { theme } = useTheme();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: card.number, data: { card } });

  const discarded = card.column === 'discarded';
  const finalized = card.column === 'finalized';
  const stage = stageOf(card.column);
  const stamp = stampOf(card);

  const style = {
    transform: CSS.Translate.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
    // Tinta da etapa (§4.3): a cor mora no card, não na coluna — assim o card
    // continua legível no DragOverlay, longe da coluna de origem.
    ...(stage ? stageCardStyle(theme, stage) : { backgroundColor: 'var(--surface)' }),
    // Prioridade = borda esquerda 3px (§4.3). A skill impeccable bane
    // side-stripe; aqui o DESIGN.md vence (decisão do PI em 2026-07-16): a cor
    // é semântica e o protótipo a tem.
    ...(card.priority
      ? { borderLeft: `3px solid ${priorityColor(theme, card.priority)}` }
      : {}),
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      onClick={() => onEdit(card)}
      className={
        'group relative cursor-grab rounded-[10px] border p-2.5 ' +
        'transition-[transform,border-color] duration-150 hover:-translate-y-px hover:border-hoverb ' +
        (pending ? 'animate-pulse border-accent-border ' : 'border-border2 ') +
        (discarded ? 'opacity-70' : '')
      }
    >
      {/* Finalizado: selo de aceite (verde = conquista) — mas se foi fechada
          fora do ProPlan, não há evidência de aceite: badge âmbar, não selo. */}
      {finalized && !card.closedOutside && (
        <span className="absolute right-1.5 top-1.5 text-[10px] text-success" title="Aceito pelo PI">
          ✓
        </span>
      )}
      {finalized && card.closedOutside && (
        <span
          className="absolute right-1.5 top-1.5 rounded bg-warning/15 px-1 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-warning"
          title="Fechada no GitHub sem passar pelo aceite do ProPlan — sem evidência de aceite do PI"
        >
          fora
        </span>
      )}
      <p
        title={card.title}
        className={
          'line-clamp-3 text-[13px] font-medium leading-snug ' +
          (discarded ? 'text-text-muted line-through' : 'text-text')
        }
      >
        {card.title}
      </p>

      {/* Carimbo datado: `--text-muted` e não `--dim` — o `--dim` reprova AA nos
          dois temas (item aberto no STATUS.md); texto pequeno exige 4.5:1. */}
      {stamp && (
        <p className="mt-1.5 font-mono text-[9.5px] tabular-nums text-text-muted">
          {stamp.label} {stamp.value}
        </p>
      )}

      <div className="mt-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          {card.assignee &&
            (card.assignee.avatarUrl ? (
              <img
                src={card.assignee.avatarUrl}
                alt={card.assignee.login}
                title={card.assignee.login}
                className="h-5 w-5 rounded-full border border-surface"
              />
            ) : (
              <span
                title={card.assignee.login}
                className="flex h-5 w-5 items-center justify-center rounded-full bg-btnbg text-[9px] font-semibold text-btnfg"
              >
                {card.assignee.login.slice(0, 2).toUpperCase()}
              </span>
            ))}
          {card.priority && (
            <span
              className={
                'rounded-full px-2 py-0.5 font-mono text-[8.5px] uppercase tracking-[0.06em] ' +
                PRIORITY_CHIP[card.priority]
              }
            >
              {PRIORITY_LABEL[card.priority]}
            </span>
          )}
        </div>
        <a
          href={card.htmlUrl}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="font-mono text-[10px] tabular-nums text-faint transition-colors duration-150 hover:text-text"
        >
          #{card.number}
        </a>
      </div>
    </div>
  );
}
