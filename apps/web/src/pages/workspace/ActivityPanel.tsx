import { useCallback, useEffect, useState } from 'react';
import { ActivityItem, api, OperationView } from '../../lib/api';
import { OperationSteps } from './OperationSteps';

interface Props {
  projectId: string;
  onClose: () => void;
  /** Muda quando um sync/promote termina — reancora o feed para pegar o novo. */
  refreshNonce: number;
}

const RUNNING_POLL_MS = 1500;

/**
 * Painel de Atividade (SPEC-010, Camada 2): o "console" do que o ProPlan fez
 * NESTE repositório. Vive no shell (não na aba) — por isso sobrevive à
 * navegação: o usuário troca de aba e continua vendo a operação em curso.
 * "Agora" faz polling das operações running; "Histórico" é a projeção de leitura.
 */
export function ActivityPanel({ projectId, onClose, refreshNonce }: Props) {
  const [running, setRunning] = useState<OperationView[]>([]);
  const [items, setItems] = useState<ActivityItem[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [includeSyncs, setIncludeSyncs] = useState(false);
  const [loading, setLoading] = useState(true);

  // Polling do "Agora" — enquanto houver operação em curso, mantém vivo.
  useEffect(() => {
    let active = true;
    async function tick() {
      if (!active) return;
      try {
        setRunning(await api.activityRunning(projectId));
      } catch {
        /* transitório */
      }
      if (active) setTimeout(() => void tick(), RUNNING_POLL_MS);
    }
    void tick();
    return () => {
      active = false;
    };
  }, [projectId]);

  // Histórico: recarrega do topo quando muda o projeto, o toggle ou o nonce.
  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const feed = await api.activityFeed(projectId, { includeSyncs });
      setItems(feed.items);
      setCursor(feed.nextCursor);
    } catch {
      /* transitório */
    } finally {
      setLoading(false);
    }
  }, [projectId, includeSyncs]);

  useEffect(() => {
    void reload();
  }, [reload, refreshNonce]);

  async function loadMore() {
    if (!cursor) return;
    const feed = await api.activityFeed(projectId, { cursor, includeSyncs });
    setItems((prev) => [...prev, ...feed.items]);
    setCursor(feed.nextCursor);
  }

  return (
    <div className="absolute inset-y-0 right-0 z-40 flex w-96 flex-col border-l border-border bg-surface shadow-xl">
      <header className="flex items-center justify-between border-b border-border px-4 py-3">
        <h2 className="text-sm font-semibold">Atividade neste repositório</h2>
        <button onClick={onClose} className="text-text-muted hover:text-text" aria-label="Fechar">
          ✕
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-auto">
        {running.length > 0 && (
          <section className="border-b border-border p-4">
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-muted">
              Agora
            </h3>
            <div className="space-y-3">
              {running.map((op) => (
                <OperationSteps key={op.id} op={op} />
              ))}
            </div>
          </section>
        )}

        <section className="p-4">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-text-muted">
              Histórico
            </h3>
            <label className="flex items-center gap-1.5 text-xs text-text-muted">
              <input
                type="checkbox"
                checked={includeSyncs}
                onChange={(e) => setIncludeSyncs(e.target.checked)}
              />
              mostrar syncs
            </label>
          </div>

          {loading && items.length === 0 ? (
            <div className="h-24 animate-pulse rounded-md bg-border/50" />
          ) : items.length === 0 ? (
            <p className="py-6 text-center text-xs text-text-muted">
              Nada ainda — o ProPlan não escreveu neste repositório.
            </p>
          ) : (
            <ul className="space-y-2.5">
              {items.map((it) => (
                <li key={it.id} className="text-xs">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="font-medium text-text">{it.title}</span>
                    <span className="shrink-0 text-text-muted" title={it.at}>
                      {relativeTime(it.at)}
                    </span>
                  </div>
                  {it.detail && <p className="text-text-muted">{it.detail}</p>}
                  {it.evidenceUrl && (
                    <a
                      href={it.evidenceUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-brand underline-offset-2 hover:underline"
                    >
                      ver no GitHub ↗
                    </a>
                  )}
                </li>
              ))}
            </ul>
          )}

          {cursor && (
            <button
              onClick={() => void loadMore()}
              className="mt-3 w-full rounded-md border border-border py-1.5 text-xs text-text-muted hover:border-brand hover:text-brand"
            >
              Carregar mais
            </button>
          )}
        </section>
      </div>
    </div>
  );
}

/** "há 2 min", "ontem", "13/07" — leitura humana da data. */
function relativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diffMs / 60000);
  if (min < 1) return 'agora';
  if (min < 60) return `há ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `há ${h}h`;
  const days = Math.floor(h / 24);
  if (days === 1) return 'ontem';
  if (days < 7) return `há ${days} dias`;
  return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
}
