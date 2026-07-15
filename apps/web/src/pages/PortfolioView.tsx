import { useEffect, useState } from 'react';
import { api, PortfolioRow, PortfolioSignal } from '../lib/api';

type State =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; rows: PortfolioRow[] };

interface Props {
  /** Abre o projeto na aba dada (deep-link do chip clicado). */
  onOpen: (projectId: string, tab: string) => void;
}

/**
 * Portfólio da fábrica (SPEC-019) — a tela diária. Lista os repos gerenciados
 * ordenados pelo radar (mais sinais em vermelho primeiro), cada linha com os 4
 * sinais crus e datados, clicáveis para a aba correspondente. Sem score de saúde
 * composto (ADR-012): os sinais ficam lado a lado, o radar só os conta.
 */
export function PortfolioView({ onOpen }: Props) {
  const [state, setState] = useState<State>({ status: 'loading' });

  useEffect(() => {
    api
      .portfolio()
      .then((rows) => setState({ status: 'ready', rows }))
      .catch((err) => setState({ status: 'error', message: String(err) }));
  }, []);

  return (
    <main className="min-w-0 flex-1 overflow-y-auto">
      <header className="sticky top-0 z-10 border-b border-border bg-bg/80 px-8 py-5 backdrop-blur">
        <h1 className="text-lg font-semibold">Portfólio</h1>
        <p className="text-sm text-text-muted">
          Sinais de risco por projeto, ordenados por atenção. Cada sinal é cru e
          datado — clique para ir à origem.
        </p>
      </header>

      <div className="p-8">
        {state.status === 'loading' && <Skeleton />}
        {state.status === 'error' && (
          <div className="rounded-md border border-error/30 bg-error/5 p-4 text-sm text-error">
            Falha ao carregar o portfólio: {state.message}
          </div>
        )}
        {state.status === 'ready' && state.rows.length === 0 && (
          <p className="text-sm text-text-muted">
            Nenhum projeto gerenciado ainda — marque repos no catálogo.
          </p>
        )}
        {state.status === 'ready' && state.rows.length > 0 && (
          <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-surface">
            {state.rows.map((row) => (
              <PortfolioLine key={row.projectId} row={row} onOpen={onOpen} />
            ))}
          </ul>
        )}
      </div>
    </main>
  );
}

function PortfolioLine({
  row,
  onOpen,
}: {
  row: PortfolioRow;
  onOpen: (projectId: string, tab: string) => void;
}) {
  return (
    <li className="flex items-center gap-4 px-4 py-3">
      {/* Marcador de atenção: nº de sinais em vermelho. */}
      <span
        title={`${row.redCount} sinal(is) em alerta`}
        className={
          'flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ' +
          (row.redCount > 0
            ? 'bg-error/15 text-error'
            : 'bg-border/60 text-text-muted')
        }
      >
        {row.redCount}
      </span>

      <button
        onClick={() => onOpen(row.projectId, 'overview')}
        className="min-w-0 shrink-0 basis-48 text-left"
      >
        <div className="truncate text-sm font-semibold hover:text-brand">
          {row.name}
        </div>
        <div className="truncate text-xs text-text-muted">{row.owner}</div>
      </button>

      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
        <Chip
          label="staleness"
          detail={
            row.stalenessDays !== null ? `${row.stalenessDays}d` : '—'
          }
          signal={row.staleness}
          onClick={() => onOpen(row.projectId, 'overview')}
        />
        <Chip
          label="cobertura"
          detail={row.coverage?.red ? 'campos ausentes' : 'ok'}
          signal={row.coverage}
          onClick={() => onOpen(row.projectId, 'overview')}
        />
        <Chip
          label="deploy"
          detail={row.deploy?.red ? 'divergente' : 'ok'}
          signal={row.deploy}
          onClick={() => onOpen(row.projectId, 'deploy')}
        />
        <Chip
          label="CI"
          detail={ciDetail(row.ci)}
          signal={row.ci}
          onClick={() => onOpen(row.projectId, 'deploy')}
        />
      </div>
    </li>
  );
}

function ciDetail(ci: PortfolioSignal | null): string {
  if (!ci) return 'sem CI';
  return ci.red ? 'falhou' : 'ok';
}

function Chip({
  label,
  detail,
  signal,
  onClick,
}: {
  label: string;
  detail: string;
  signal: PortfolioSignal | null;
  onClick: () => void;
}) {
  const red = signal?.red ?? false;
  const observed = signal?.observedAt
    ? `lido ${new Date(signal.observedAt).toLocaleDateString('pt-BR')}`
    : 'sem leitura';
  return (
    <button
      onClick={onClick}
      title={observed}
      className={
        'rounded-full border px-2 py-0.5 text-[11px] font-medium transition-colors duration-150 ' +
        (red
          ? 'border-error/40 bg-error/10 text-error hover:bg-error/15'
          : 'border-border bg-bg text-text-muted hover:border-brand/40 hover:text-brand')
      }
    >
      {label} · {detail}
    </button>
  );
}

function Skeleton() {
  return (
    <ul className="space-y-px overflow-hidden rounded-lg border border-border">
      {Array.from({ length: 6 }).map((_, i) => (
        <li key={i} className="h-[52px] animate-pulse bg-surface" />
      ))}
    </ul>
  );
}
