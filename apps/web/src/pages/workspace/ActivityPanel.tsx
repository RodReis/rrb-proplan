import { useCallback, useEffect, useState } from 'react';
import { ActivityItem, ActivityItemKind, api, OperationView } from '../../lib/api';

interface Props {
  projectId: string;
  projectName: string;
  onClose: () => void;
  /** Muda quando um sync/promote termina — reancora o feed para pegar o novo. */
  refreshNonce: number;
}

const RUNNING_POLL_MS = 1500;

/** Grupo visual por tipo de item (SPEC-010 + polish terminal-carbono). */
type Group = 'ai' | 'write' | 'sync';
const GROUP_OF: Record<ActivityItemKind, Group> = {
  insight_run: 'ai',
  operation: 'write',
  board_mutation: 'write',
  sync: 'sync',
};
const GROUP_META: Record<Group, { tag: string; mark: string }> = {
  ai: { tag: 'IA', mark: '◆' },
  write: { tag: 'Escrita', mark: '✎' },
  sync: { tag: 'Sync', mark: '↻' },
};

/**
 * Resumo do último lote de inferência de IA (SPEC-011): torna a economia da 7.7
 * óbvia de relance — quantas chamadas foram feitas × reaproveitadas e o custo —
 * e orienta o próximo passo (recarregar para ver o resultado). Deriva do próprio
 * feed já carregado; agrupa as linhas de IA dentro de ~2 min da mais recente.
 */
function LastSyncSummary({ items }: { items: ActivityItem[] }) {
  const ai = items.filter((i) => i.kind === 'insight_run');
  if (ai.length === 0) return null;

  const newestAt = new Date(ai[0].at).getTime();
  const batch = ai.filter((i) => newestAt - new Date(i.at).getTime() <= 120_000);
  const generated = batch.filter((i) => i.detail !== 'Sem chamar a IA (sem custo)' && !/^Reaproveitou/.test(i.title));
  const reused = batch.length - generated.length;
  const totalTokens = generated.reduce(
    (s, i) => s + (i.cost ? i.cost.inputTokens + i.cost.outputTokens : 0),
    0,
  );

  return (
    <section className="act-summary">
      <div className="act-summary-h">
        <span>Última rodada de IA</span>
        <span className="act-summary-when">{relativeTime(ai[0].at)}</span>
      </div>
      <div className="act-summary-body">
        <strong>{generated.length}</strong> gerad{generated.length === 1 ? 'a' : 'as'}
        {' · '}
        <strong>{reused}</strong> reaproveitad{reused === 1 ? 'a' : 'as'} (sem custo)
        {totalTokens > 0 && <> · <strong>{totalTokens.toLocaleString('pt-BR')} tokens</strong></>}
      </div>
      {reused > 0 && (
        <div className="act-summary-econ">
          Economizou {reused} chamada{reused === 1 ? '' : 's'} de IA — o texto não mudou desde a última vez.
        </div>
      )}
      <div className="act-summary-next">
        Próximo passo: <b>Sincronizar</b> após editar docs → <b>recarregar (F5)</b> → o resultado aparece na aba correspondente (Grafo, Arquitetura, Visão Geral).
      </div>
    </section>
  );
}

/** Passos de uma operação em curso, na paleta do terminal (fundo carbono). */
function TermSteps({ op }: { op: OperationView }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      {op.steps.map((s) => {
        const on = s.status === 'done' || s.status === 'running';
        const glyph =
          s.status === 'done' ? '✓' : s.status === 'failed' ? '✕' : s.status === 'running' ? '◐' : '○';
        const color =
          s.status === 'done'
            ? 'var(--g-sync)'
            : s.status === 'failed'
              ? 'var(--g-error)'
              : s.status === 'running'
                ? 'var(--g-write)'
                : 'var(--term-faint)';
        return (
          <div
            key={s.key}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 9,
              fontFamily: 'var(--mono)',
              fontSize: 11.5,
              padding: '3px 0',
              color: on ? 'var(--term-ink)' : 'var(--term-dim)',
            }}
          >
            <span
              style={{ width: 12, textAlign: 'center', color }}
              className={s.status === 'running' ? 'act-spin' : undefined}
            >
              {glyph}
            </span>
            {s.label}
          </div>
        );
      })}
      {op.status === 'failed' && op.error && (
        <p style={{ marginTop: 6, fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--g-error)' }}>
          {op.error}
        </p>
      )}
    </div>
  );
}

/**
 * Painel de Atividade (SPEC-010, Camada 2). Estética de terminal de log em
 * carbono (aprovada pelo PI): fundo escuro, fonte mono, cores por grupo —
 * IA azul, escrita roxo, sync verde. Vive no shell → sobrevive à navegação.
 */
export function ActivityPanel({ projectId, projectName, onClose, refreshNonce }: Props) {
  const [running, setRunning] = useState<OperationView[]>([]);
  const [items, setItems] = useState<ActivityItem[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [includeSyncs, setIncludeSyncs] = useState(false);
  const [loading, setLoading] = useState(true);

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
    <aside className="act-panel">
      <header className="act-titlebar">
        <span className="act-dots" aria-hidden>
          <i />
          <i />
          <i />
        </span>
        <span className="act-title">
          proplan ~ <b>{projectName}</b>
        </span>
        <button className="act-x" onClick={onClose} aria-label="Fechar painel de Atividade">
          ✕
        </button>
      </header>

      <div className="act-scroll">
        {running.length > 0 && (
          <section className="act-now">
            <div className="act-now-h">Agora</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {running.map((op) => (
                <TermSteps key={op.id} op={op} />
              ))}
            </div>
          </section>
        )}

        <LastSyncSummary items={items} />

        <div className="act-subhead">
          <span className="act-subhead-h">Histórico</span>
          <label className="act-toggle">
            <input
              type="checkbox"
              checked={includeSyncs}
              onChange={(e) => setIncludeSyncs(e.target.checked)}
            />
            mostrar syncs
          </label>
        </div>

        {loading && items.length === 0 ? (
          <div className="act-skeleton" />
        ) : items.length === 0 ? (
          <p className="act-empty">Nada ainda — o ProPlan não escreveu neste repositório.</p>
        ) : (
          <div className="act-feed">
            {items.map((it) => {
              const g = GROUP_OF[it.kind];
              const meta = GROUP_META[g];
              return (
                <div key={it.id} className={`act-row act-g-${g}`}>
                  <span className="act-mark" aria-hidden>
                    {meta.mark}
                  </span>
                  <div className="act-body">
                    <div className="act-title-line">
                      <span className="act-tag">{meta.tag}</span>
                      <span className="act-name">{it.title}</span>
                    </div>
                    {(it.detail || it.evidenceUrl) && (
                      <div className="act-meta">
                        {it.evidenceUrl ? (
                          <a href={it.evidenceUrl} target="_blank" rel="noopener noreferrer">
                            {it.detail ? `${it.detail} · ` : ''}ver no GitHub ↗
                          </a>
                        ) : (
                          it.detail
                        )}
                      </div>
                    )}
                  </div>
                  <span className="act-time">{relativeTime(it.at)}</span>
                </div>
              );
            })}
          </div>
        )}

        {cursor && (
          <button className="act-more" onClick={() => void loadMore()}>
            Carregar mais
          </button>
        )}
      </div>
    </aside>
  );
}

/** "há 2 min", "ontem", "13/07" — leitura humana da data. */
function relativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diffMs / 60000);
  if (min < 1) return 'agora';
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} h`;
  const days = Math.floor(h / 24);
  if (days === 1) return 'ontem';
  if (days < 7) return `${days} d`;
  return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
}
