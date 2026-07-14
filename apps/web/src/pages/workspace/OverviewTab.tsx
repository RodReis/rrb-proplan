import { useCallback, useEffect, useState } from 'react';
import { api, CurrentMonthUsage, Freshness, InsightSummary } from '../../lib/api';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { BootstrapDialog } from './BootstrapDialog';

interface Props {
  projectId: string;
  /** true se o projeto tem docs/STATUS.md ingerido (controla CTA bootstrap). */
  hasStatusDoc: boolean;
  onSynced: () => void;
}

type SummaryState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; summary: InsightSummary | null };

export function OverviewTab({ projectId, hasStatusDoc, onSynced }: Props) {
  const [state, setState] = useState<SummaryState>({ status: 'loading' });
  const [freshness, setFreshness] = useState<Freshness | null>(null);
  const [usage, setUsage] = useState<CurrentMonthUsage | null>(null);
  const [regenerating, setRegenerating] = useState(false);
  const [confirmRegen, setConfirmRegen] = useState(false);
  const [bootstrapOpen, setBootstrapOpen] = useState(false);

  const load = useCallback(() => {
    setState({ status: 'loading' });
    api
      .summary(projectId)
      .then((summary) => setState({ status: 'ready', summary }))
      .catch((err) => setState({ status: 'error', message: String(err) }));
    api.freshness(projectId).then(setFreshness).catch(() => setFreshness(null));
    api.usageCurrentMonth().then(setUsage).catch(() => setUsage(null));
  }, [projectId]);

  useEffect(load, [load]);

  async function regenerate() {
    setConfirmRegen(false);
    setRegenerating(true);
    try {
      const summary = await api.regenerateSummary(projectId);
      setState({ status: 'ready', summary });
    } catch (err) {
      setState({ status: 'error', message: String(err) });
    } finally {
      setRegenerating(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-8 py-6">
      {freshness && <FreshnessBar freshness={freshness} />}
      {usage && <UsageAlert usage={usage} />}

      {state.status === 'loading' && <SummarySkeleton />}

      {state.status === 'error' && (
        <div className="flex flex-col items-start gap-2 rounded-md border border-error/30 bg-error/5 p-4">
          <p className="text-sm text-error">
            Falha ao gerar o resumo: {state.message}
          </p>
          <button
            onClick={load}
            className="rounded-md border border-border px-3 py-1.5 text-xs font-semibold hover:border-brand hover:text-brand"
          >
            Tentar de novo
          </button>
        </div>
      )}

      {state.status === 'ready' && !state.summary && (
        <div className="rounded-md border border-border bg-surface p-6 text-center">
          <p className="text-sm font-medium">Resumo ainda não gerado</p>
          <p className="mt-1 text-xs text-text-muted">
            O resumo é criado automaticamente após a sincronização. Se demorar,
            gere agora.
          </p>
          <button
            onClick={regenerate}
            disabled={regenerating}
            className="mt-3 rounded-md border border-brand bg-brand/5 px-3 py-1.5 text-xs font-semibold text-brand hover:bg-brand/10 disabled:opacity-50"
          >
            {regenerating ? 'Gerando…' : 'Gerar resumo'}
          </button>
        </div>
      )}

      {state.status === 'ready' && state.summary && (
        <>
          <div className="flex items-center justify-between">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-warning/40 px-2.5 py-1 text-xs font-medium text-warning">
              inferido por IA · {state.summary.provider}
            </span>
            <button
              onClick={() => setConfirmRegen(true)}
              disabled={regenerating}
              className="rounded-md border border-border px-3 py-1.5 text-xs font-semibold hover:border-brand hover:text-brand disabled:opacity-50"
            >
              {regenerating ? 'Gerando…' : 'Regenerar'}
            </button>
          </div>

          <Block title="O que é" text={state.summary.content.oQueE} />
          <Block title="Onde parou" text={state.summary.content.ondeParou} />
          <div className="rounded-lg border border-border bg-surface p-4">
            <h3 className="mb-2 text-sm font-semibold">O que falta</h3>
            <ul className="space-y-1">
              {state.summary.content.oQueFalta.map((item, i) => (
                <li key={i} className="flex gap-2 text-sm text-text-muted">
                  <span className="text-brand">•</span>
                  {item}
                </li>
              ))}
            </ul>
          </div>
        </>
      )}

      {!hasStatusDoc && (
        <div className="rounded-lg border border-dashed border-border p-4 text-center">
          <p className="text-sm font-medium">Sem STATUS.md</p>
          <p className="mt-1 text-xs text-text-muted">
            Gere uma proposta de Kanban a partir da documentação e commite no
            repositório.
          </p>
          <button
            onClick={() => setBootstrapOpen(true)}
            className="mt-3 rounded-md border border-brand bg-brand/5 px-3 py-1.5 text-xs font-semibold text-brand hover:bg-brand/10"
          >
            Gerar proposta de STATUS.md
          </button>
        </div>
      )}

      {bootstrapOpen && (
        <BootstrapDialog
          projectId={projectId}
          onClose={() => setBootstrapOpen(false)}
          onCommitted={() => {
            setBootstrapOpen(false);
            onSynced();
          }}
        />
      )}

      {confirmRegen && (
        <ConfirmDialog
          title="Regenerar resumo"
          message="Regenerar o resumo consome tokens do provedor de IA. Continuar?"
          confirmLabel="Regenerar"
          onConfirm={() => void regenerate()}
          onCancel={() => setConfirmRegen(false)}
        />
      )}
    </div>
  );
}

function Block({ title, text }: { title: string; text: string }) {
  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <h3 className="mb-1 text-sm font-semibold">{title}</h3>
      <p className="text-sm text-text-muted">{text}</p>
    </div>
  );
}

function FreshnessBar({ freshness }: { freshness: Freshness }) {
  const docs = relativeDate(freshness.lastDocsCommitAt);
  const code = relativeDate(freshness.lastCodeCommitAt);
  const base =
    'flex items-center gap-2 rounded-md px-3 py-2 text-xs transition-colors duration-200';
  if (freshness.stale) {
    return (
      <div
        className={base + ' border border-warning/30 bg-warning/10 text-warning'}
        title="O último commit de código é mais recente que o de docs por mais que o limiar configurado. Ajuste em Configurações."
      >
        <span>⚠️</span>
        <span className="font-medium">Documentação possivelmente defasada</span>
        <span className="text-text-muted">
          · Docs: {docs} · Código: {code}
        </span>
      </div>
    );
  }
  return (
    <div className={base + ' bg-surface text-text-muted'}>
      Docs: {docs} · Código: {code}
    </div>
  );
}

function relativeDate(iso: string | null): string {
  if (!iso) return '—';
  const then = new Date(iso).getTime();
  const days = Math.floor((Date.now() - then) / (1000 * 60 * 60 * 24));
  if (days < 1) return 'hoje';
  if (days < 30) return `há ${days} dia${days > 1 ? 's' : ''}`;
  const months = Math.floor(days / 30);
  if (months < 12) return `há ${months} ${months > 1 ? 'meses' : 'mês'}`;
  const years = Math.floor(months / 12);
  return `há ${years} ano${years > 1 ? 's' : ''}`;
}

function SummarySkeleton() {
  return (
    <div className="space-y-4">
      {Array.from({ length: 3 }).map((_, i) => (
        <div key={i} className="h-24 animate-pulse rounded-lg bg-border/50" />
      ))}
    </div>
  );
}

/**
 * Faixa de gasto de IA (SPEC-009). Só aparece quando passou do alerta ou bateu
 * o teto — silenciosa dentro do orçamento (como a de frescor, é sinal, não ruído).
 */
function UsageAlert({ usage }: { usage: CurrentMonthUsage }) {
  const spent = Number(usage.costUsd);
  const alert = Number(usage.alertUsd);
  const overAlert = alert > 0 && spent >= alert;
  if (!usage.blocked && !overAlert) return null;

  const color = usage.blocked ? 'var(--color-error)' : 'var(--color-warning)';
  const money = (v: string) => `$${Number(v).toFixed(2)}`;
  return (
    <div
      className="flex items-center gap-2 rounded-md px-4 py-2.5 text-sm"
      style={{
        border: `1px solid color-mix(in oklab, ${color} 30%, transparent)`,
        background: `color-mix(in oklab, ${color} 8%, transparent)`,
        color,
      }}
    >
      <span aria-hidden>{usage.blocked ? '⛔' : '⚠️'}</span>
      <span>
        {usage.blocked
          ? `Teto de gasto de IA atingido (${money(usage.costUsd)}/${money(usage.capUsd)}) — inferências pausadas este mês.`
          : `Gasto de IA acima do alerta (${money(usage.costUsd)} de ${money(usage.capUsd)} do teto).`}{' '}
        <span className="opacity-80">Ajuste em Configurações → Uso de IA.</span>
      </span>
    </div>
  );
}
