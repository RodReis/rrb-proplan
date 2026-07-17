import { useEffect, useState } from 'react';
import { ActivityItem, ActivityItemKind, api, OperationView } from '../../lib/api';

interface Props {
  projectId: string;
  projectName: string;
  onClose: () => void;
  /** Muda quando um sync/promote termina — reancora o feed para pegar o novo. */
  refreshNonce: number;
  /** Tocando a animação de saída — o nó ainda existe, mas já está indo embora. */
  leaving?: boolean;
  /** Sinal de vida: interação do usuário ou operação em curso. O Workspace usa
   *  para adiar o auto-close de 4s — não fecha na cara de quem lê nem no meio
   *  de um job. Opcional: sem auto-close (aberto pela pílula) não é passado. */
  onActivity?: () => void;
}

// Polling adaptativo do painel (o F5 manual morreu — SPEC-010): rápido enquanto
// há trabalho chegando, lento em repouso. Os jobs de IA são assíncronos e
// terminam depois do sync HTTP; o painel precisa se acompanhar sozinho.
const ACTIVE_POLL_MS = 2000; // há operação em curso ou o feed acabou de mudar
const REST_POLL_MS = 15000; // estabilizou — sondagem lenta pega mudança externa
const QUIET_TICKS_TO_REST = 3; // ~6s sem novidade → entra em repouso

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
        <span>Nesta sincronização</span>
        <span className="act-summary-when">{relativeTime(ai[0].at)}</span>
      </div>

      <div className="act-summary-metrics">
        <div className="act-metric">
          <span className="act-metric-n">{generated.length}</span>
          <span className="act-metric-lbl">
            {generated.length === 1 ? 'inferência gerada' : 'inferências geradas'}
          </span>
          {totalTokens > 0 && (
            <span className="act-metric-sub">
              {totalTokens.toLocaleString('pt-BR')} tokens gastos
            </span>
          )}
        </div>
        <div className="act-metric">
          <span className="act-metric-n">{reused}</span>
          <span className="act-metric-lbl">
            {reused === 1 ? 'reaproveitada' : 'reaproveitadas'}
          </span>
          <span className="act-metric-sub act-metric-free">
            {reused > 0 ? 'sem novo gasto' : '—'}
          </span>
        </div>
      </div>

      {reused > 0 && (
        <div className="act-summary-econ">
          Economizou {reused} chamada{reused === 1 ? '' : 's'} — esses documentos não mudaram desde a última vez.
        </div>
      )}
      <div className="act-summary-next">
        Edite os docs e <b>Sincronize</b> — este painel acompanha sozinho e mostra
        cada inferência assim que a IA termina.
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
export function ActivityPanel({
  projectId,
  projectName,
  onClose,
  refreshNonce,
  leaving,
  onActivity,
}: Props) {
  const [running, setRunning] = useState<OperationView[]>([]);
  const [items, setItems] = useState<ActivityItem[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [includeSyncs, setIncludeSyncs] = useState(false);

  // Esc fecha a gaveta (§11: "fechar modal/gaveta com Esc sempre"). Faltava.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Enquanto há operação em curso, adia o auto-close: um job rodando é conteúdo
  // que muda, não gaveta esquecida aberta. Re-dispara a cada mudança de estado
  // do polling, mantendo a contagem de 4s zerada até o trabalho acabar.
  useEffect(() => {
    if (running.length > 0) onActivity?.();
  }, [running, onActivity]);
  const [loading, setLoading] = useState(true);

  // Polling adaptativo: os jobs de IA (summary/edges/classify) rodam ASSÍNCRONOS
  // (BullMQ), terminando ~30s DEPOIS do sync HTTP retornar. Sem isto, o feed
  // buscaria cedo demais e o usuário precisaria de F5 para ver as linhas novas.
  // Aqui o painel se acompanha sozinho: recarrega feed+running a cada tick e
  // PARA quando não há operação em curso e o feed ficou 2 ciclos sem mudar
  // (a IA estabilizou). Reancorado a cada sync via refreshNonce.
  useEffect(() => {
    let active = true;
    let quietTicks = 0;
    let lastTopId: string | null = null;

    async function tick() {
      if (!active) return;
      let running: OperationView[] = [];
      let feedChanged = false;
      try {
        [running] = await Promise.all([
          api.activityRunning(projectId).then((r) => {
            setRunning(r);
            return r;
          }),
          api.activityFeed(projectId, { includeSyncs }).then((feed) => {
            if (!active) return;
            const topId = feed.items[0]?.id ?? null;
            feedChanged = topId !== lastTopId;
            lastTopId = topId;
            setItems(feed.items);
            setCursor(feed.nextCursor);
            setLoading(false);
          }),
        ]);
      } catch {
        /* transitório — segue tentando */
      }
      if (!active) return;
      // Continua rápido enquanto há operação em curso OU o feed acabou de mudar
      // (IA ainda chegando); senão conta silêncio e desacelera/para.
      if (running.length > 0 || feedChanged) quietTicks = 0;
      else quietTicks += 1;
      if (quietTicks < QUIET_TICKS_TO_REST) {
        setTimeout(() => void tick(), ACTIVE_POLL_MS);
      } else {
        // Repouso: uma sondagem lenta ocasional pega mudanças vindas de fora
        // (outro cliente, webhook) sem manter o painel em polling apertado.
        setTimeout(() => void tick(), REST_POLL_MS);
      }
    }
    void tick();
    return () => {
      active = false;
    };
  }, [projectId, includeSyncs, refreshNonce]);

  async function loadMore() {
    if (!cursor) return;
    const feed = await api.activityFeed(projectId, { cursor, includeSyncs });
    setItems((prev) => [...prev, ...feed.items]);
    setCursor(feed.nextCursor);
  }

  return (
    <aside
      className={'act-panel' + (leaving ? ' act-panel--leaving' : '')}
      aria-label={`Atividade de ${projectName}`}
      onPointerMove={onActivity}
      onWheel={onActivity}
      onPointerDown={onActivity}
      onFocusCapture={onActivity}
    >
      <header className="act-titlebar">
        <span className="act-title">
          Atividade · <b>{projectName}</b>
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
