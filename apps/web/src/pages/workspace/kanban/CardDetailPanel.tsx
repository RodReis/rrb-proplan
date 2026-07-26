import { useCallback, useEffect, useState } from 'react';
import type { BoardCard, CardDetail, CardEvent } from '../../../lib/api';
import { api } from '../../../lib/api';
import { MarkdownView } from '../MarkdownView';
import {
  describeEvent,
  labelTextColor,
  splitTimeline,
  stateLabel,
} from './cardDetailView';
import { formatStamp } from './KanbanCard';
import { COLUMN_LABEL, PRIORITY_CHIP, PRIORITY_LABEL } from './columns';

interface Props {
  /** O card do cache do board — é o que sustenta o modo degradado. */
  card: BoardCard;
  projectId: string;
  /** Saída animada: a classe de leaving vem de fora (padrão do ActivityPanel). */
  leaving?: boolean;
  /** Muda ⇒ relê. O pai o incrementa ao salvar a edição (reflete sem F5). */
  refreshNonce?: number;
  /** `false` ⇒ viewer ou board degradado: lê, não edita. */
  canEdit: boolean;
  onClose: () => void;
  onEdit: () => void;
}

type State =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; detail: CardDetail };

/**
 * Gaveta de leitura do card (SPEC-030): corpo da issue, metadados e trilha,
 * lidos **ao vivo** no GitHub a cada abertura e descartados ao fechar (ADR-017 —
 * não ser a segunda fonte defasada de um fato que o GitHub serve agora).
 *
 * Editar é modo secundário: o botão abre o `EditCardPopover` existente, sem
 * mudança de contrato.
 */
export function CardDetailPanel({
  card,
  projectId,
  leaving,
  refreshNonce = 0,
  canEdit,
  onClose,
  onEdit,
}: Props) {
  const [state, setState] = useState<State>({ status: 'loading' });
  const [expanded, setExpanded] = useState(false);
  const [nonce, setNonce] = useState(0);

  // Nova leitura a cada abertura e a cada "tentar de novo" (nonce). O guard
  // `active` evita que resposta atrasada de um card já fechado pinte a gaveta
  // de outro — o critério "fechar e reabrir faz nova leitura" depende disto.
  useEffect(() => {
    let active = true;
    setState({ status: 'loading' });
    setExpanded(false);
    api
      .cardDetail(projectId, card.number)
      .then((detail) => active && setState({ status: 'ready', detail }))
      .catch(
        (err) => active && setState({ status: 'error', message: String(err) }),
      );
    return () => {
      active = false;
    };
  }, [projectId, card.number, nonce, refreshNonce]);

  const retry = useCallback(() => setNonce((n) => n + 1), []);

  // Esc fecha (DESIGN.md §11). `capture` + `stopPropagation` no popover de
  // edição não resolveriam: o popover não escuta Esc. Quem decide é o pai, que
  // só monta esta gaveta quando o popover está fechado.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const detail = state.status === 'ready' ? state.detail : null;

  return (
    <>
      {/* Backdrop: fecha ao clicar fora, e escurece o board sem esconder que
          ele continua lá. `bg-text/20` é o padrão dos modais — token, não preto. */}
      <div
        className="fixed inset-0 z-40 bg-text/20"
        onClick={onClose}
        aria-hidden="true"
      />
      <aside
        className={`card-drawer${leaving ? ' card-drawer--leaving' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={`Card #${card.number}`}
      >
        <header className="flex items-start justify-between gap-3 border-b border-border2 px-5 py-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-xs text-muted">
              <a
                href={card.htmlUrl}
                target="_blank"
                rel="noreferrer"
                className="font-mono font-semibold text-accent hover:underline"
              >
                #{card.number}
              </a>
              <span
                className={
                  (detail?.state ?? (card.closedAt ? 'closed' : 'open')) === 'open'
                    ? 'text-success'
                    : 'text-muted'
                }
              >
                {stateLabel(detail?.state ?? (card.closedAt ? 'closed' : 'open'))}
              </span>
              <span aria-hidden="true">·</span>
              <span>{COLUMN_LABEL[card.column]}</span>
            </div>
            {/* Título completo, sem truncar (critério da spec). */}
            <h2 className="mt-1 text-base font-semibold leading-snug text-text2">
              {detail?.title ?? card.title}
            </h2>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {canEdit && (
              <button
                type="button"
                onClick={onEdit}
                className="rounded-md border border-border2 px-3 py-1.5 text-xs font-semibold text-text2 transition-colors duration-150 hover:bg-surface-hover"
              >
                Editar
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              aria-label="Fechar detalhe do card"
              className="px-1 text-muted transition-colors duration-150 hover:text-text"
            >
              ✕
            </button>
          </div>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-4">
          {state.status === 'loading' && <DetailSkeleton />}

          {state.status === 'error' && (
            <DegradedNotice card={card} message={state.message} onRetry={retry} />
          )}

          {detail && (
            <>
              <MetaBlock card={card} detail={detail} />

              <section className="mt-5">
                {detail.body ? (
                  <MarkdownView markdown={detail.body} />
                ) : (
                  <p className="text-sm italic text-muted">Sem descrição.</p>
                )}
              </section>

              <Timeline
                events={detail.timeline}
                expanded={expanded}
                onExpand={() => setExpanded(true)}
              />

              <footer className="mt-6 flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-border pt-3 text-xs text-dim">
                <span>Leitura ao vivo em {formatStamp(detail.fetchedAt)}</span>
                <span aria-hidden="true">·</span>
                <a
                  href={detail.htmlUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-accent hover:underline"
                >
                  abrir no GitHub
                </a>
              </footer>
            </>
          )}
        </div>
      </aside>
    </>
  );
}

/** Cabeçalho de metadados: labels, autor, assignees e as três datas. */
function MetaBlock({ card, detail }: { card: BoardCard; detail: CardDetail }) {
  const criado = formatStamp(detail.createdAt);
  const atualizado = formatStamp(detail.updatedAt);
  const fechado = formatStamp(detail.closedAt);

  return (
    <div className="space-y-3 rounded-md border border-border bg-surface px-4 py-3">
      {(detail.labels.length > 0 || card.priority) && (
        <div className="flex flex-wrap items-center gap-1.5">
          {card.priority && (
            <span
              className={`rounded px-1.5 py-0.5 text-[11px] font-semibold ${PRIORITY_CHIP[card.priority]}`}
            >
              {PRIORITY_LABEL[card.priority]}
            </span>
          )}
          {detail.labels.map((l) => (
            <span
              key={l.name}
              // Cor vem do GitHub sem tradução (contrato da spec) — é o único
              // lugar do app com cor absoluta, e por isso vai inline: um token
              // do Carbono/Claro aqui mentiria sobre qual label é qual.
              style={{ backgroundColor: `#${l.color}`, color: labelTextColor(l.color) }}
              className="rounded-full px-2 py-0.5 text-[11px] font-medium"
            >
              {l.name}
            </span>
          ))}
        </div>
      )}

      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
        <dt className="text-dim">autor</dt>
        <dd className="text-body2">{detail.author?.login ?? '—'}</dd>

        <dt className="text-dim">responsáveis</dt>
        <dd className="text-body2">
          {detail.assignees.length > 0
            ? detail.assignees.map((a) => a.login).join(', ')
            : 'ninguém'}
        </dd>

        {criado && (
          <>
            <dt className="text-dim">aberta em</dt>
            <dd className="text-body2">{criado}</dd>
          </>
        )}
        {atualizado && (
          <>
            <dt className="text-dim">atualizada em</dt>
            <dd className="text-body2">{atualizado}</dd>
          </>
        )}
        {fechado && (
          <>
            <dt className="text-dim">fechada em</dt>
            <dd className="text-body2">{fechado}</dd>
          </>
        )}
      </dl>
    </div>
  );
}

/** Trilha de eventos: 10 mais recentes + "ver todos" que expande em linha. */
function Timeline({
  events,
  expanded,
  onExpand,
}: {
  events: CardEvent[];
  expanded: boolean;
  onExpand: () => void;
}) {
  const { visible, hiddenCount } = splitTimeline(events, expanded);

  return (
    <section className="mt-6">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-dim">
        Trilha
      </h3>
      {visible.length === 0 ? (
        <p className="mt-2 text-sm text-muted">Sem eventos registrados.</p>
      ) : (
        <ol className="mt-2 space-y-1.5">
          {visible.map((e, i) => (
            <li
              key={`${e.type}-${e.createdAt}-${i}`}
              className="flex flex-wrap items-baseline gap-x-1.5 text-xs"
            >
              <span className="text-body2">{describeEvent(e)}</span>
              {e.label && (
                <span
                  style={{
                    backgroundColor: `#${e.label.color}`,
                    color: labelTextColor(e.label.color),
                  }}
                  className="rounded-full px-1.5 py-px text-[10px] font-medium"
                >
                  {e.label.name}
                </span>
              )}
              {e.rename && (
                <span className="text-muted">
                  “{e.rename.from}” → “{e.rename.to}”
                </span>
              )}
              <span className="text-dim">{formatStamp(e.createdAt)}</span>
            </li>
          ))}
        </ol>
      )}
      {hiddenCount > 0 && (
        <button
          type="button"
          onClick={onExpand}
          className="mt-2 text-xs font-semibold text-accent hover:underline"
        >
          ver todos ({hiddenCount} anteriores)
        </button>
      )}
    </section>
  );
}

/**
 * Modo degradado: a leitura falhou (rate limit, issue removida, permissão), mas
 * o cache do board tem título, coluna, prioridade e link. Nunca painel em branco.
 */
function DegradedNotice({
  card,
  message,
  onRetry,
}: {
  card: BoardCard;
  message: string;
  onRetry: () => void;
}) {
  return (
    <div className="space-y-4">
      <div className="rounded-md border border-warning bg-surface px-4 py-3">
        <p className="text-sm font-semibold text-warning-strong">
          Não foi possível ler esta issue no GitHub.
        </p>
        <p className="mt-1 text-xs text-body2">
          O corpo e a trilha não puderam ser carregados. O que aparece abaixo vem
          do cache do board — pode estar defasado.
        </p>
        {/* A mensagem crua fica: rate limit e permissão pedem ações diferentes,
            e esconder qual foi obrigaria o dono a adivinhar. */}
        <p className="mt-2 break-words font-mono text-[11px] text-dim">{message}</p>
        <button
          type="button"
          onClick={onRetry}
          className="mt-3 rounded-md border border-border2 px-3 py-1.5 text-xs font-semibold text-text2 transition-colors duration-150 hover:bg-surface-hover"
        >
          Tentar de novo
        </button>
      </div>

      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 rounded-md border border-border bg-surface px-4 py-3 text-xs">
        <dt className="text-dim">coluna</dt>
        <dd className="text-body2">{COLUMN_LABEL[card.column]}</dd>
        {card.priority && (
          <>
            <dt className="text-dim">prioridade</dt>
            <dd className="text-body2">{PRIORITY_LABEL[card.priority]}</dd>
          </>
        )}
        <dt className="text-dim">responsável</dt>
        <dd className="text-body2">{card.assignee?.login ?? 'ninguém'}</dd>
      </dl>

      <a
        href={card.htmlUrl}
        target="_blank"
        rel="noreferrer"
        className="inline-block text-xs font-semibold text-accent hover:underline"
      >
        abrir no GitHub
      </a>
    </div>
  );
}

/** Skeleton, não spinner (DESIGN.md §9). */
function DetailSkeleton() {
  return (
    <div className="space-y-4">
      <div className="h-24 animate-pulse rounded-md bg-surface-hover" />
      <div className="h-4 w-2/3 animate-pulse rounded bg-surface-hover" />
      <div className="h-40 animate-pulse rounded-md bg-surface-hover" />
    </div>
  );
}
