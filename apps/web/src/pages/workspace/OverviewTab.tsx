import { useCallback, useEffect, useState } from 'react';
import {
  api,
  CurrentMonthUsage,
  Freshness,
  InsightSummary,
  Project,
} from '../../lib/api';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { OverviewSignals } from './OverviewSignals';

interface Props {
  project: Project;
}

type SummaryState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; summary: InsightSummary | null };

/**
 * Visão Geral — o resumo executivo (protótipo `ProPlan Workspace.dc.html`):
 * 4 sinais datados no topo, depois o que a IA inferiu da documentação.
 */
export function OverviewTab({ project }: Props) {
  const projectId = project.id;
  const [state, setState] = useState<SummaryState>({ status: 'loading' });
  const [freshness, setFreshness] = useState<Freshness | null>(null);
  const [usage, setUsage] = useState<CurrentMonthUsage | null>(null);
  const [awaiting, setAwaiting] = useState<number | null>(null);
  const [regenerating, setRegenerating] = useState(false);
  const [confirmRegen, setConfirmRegen] = useState(false);

  const load = useCallback(() => {
    setState({ status: 'loading' });
    api
      .summary(projectId)
      .then((summary) => setState({ status: 'ready', summary }))
      .catch((err) => setState({ status: 'error', message: String(err) }));
    api.freshness(projectId).then(setFreshness).catch(() => setFreshness(null));
    api.usageCurrentMonth().then(setUsage).catch(() => setUsage(null));
    // O board vem só pelo contador da fila de aceite (decisão do PI em
    // 2026-07-16): é o sinal que carrega a tese do produto. Falhou → null, e o
    // cartão diz que não sabe em vez de fingir zero (ADR-014).
    api
      .board(projectId)
      .then((b) => {
        const done = b.columns.find((c) => c.column === 'done');
        setAwaiting(done ? done.cards.length : 0);
      })
      .catch(() => setAwaiting(null));
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
    <div className="mx-auto max-w-[1060px] space-y-5 px-8 py-7">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-[22px] font-semibold tracking-[-0.01em] text-text">
            Visão Geral
          </h1>
          <p className="mt-1 text-[13px] text-muted">
            O resumo executivo: o que é o projeto, onde parou e o que falta.
          </p>
        </div>
        <a
          href={`https://github.com/${project.owner}/${project.name}`}
          target="_blank"
          rel="noopener noreferrer"
          className="shrink-0 text-xs text-muted transition-colors duration-150 hover:text-text"
        >
          Abrir no GitHub ↗
        </a>
      </header>

      <OverviewSignals
        freshness={freshness}
        awaitingAcceptance={awaiting}
        lastSyncAt={project.lastSyncAt}
        deployVerdict={project.deployVerdict}
      />

      {usage && <UsageAlert usage={usage} />}

      {state.status === 'loading' && <SummarySkeleton />}

      {state.status === 'error' && (
        <div className="flex flex-col items-start gap-2 rounded-[14px] border border-error/30 bg-error/5 p-4">
          <p className="text-sm text-error">Falha ao gerar o resumo: {state.message}</p>
          <button
            onClick={load}
            className="rounded-[10px] border border-border2 px-3 py-1.5 text-xs font-semibold text-body2 transition-colors duration-150 hover:border-hoverb hover:text-text"
          >
            Tentar de novo
          </button>
        </div>
      )}

      {state.status === 'ready' && !state.summary && (
        <div className="rounded-[14px] border border-border2 bg-surface p-6 text-center">
          <p className="text-sm font-medium text-text">Resumo ainda não gerado</p>
          <p className="mt-1 text-xs text-muted">
            O resumo é criado automaticamente após a sincronização. Se demorar, gere
            agora.
          </p>
          <button
            onClick={() => setConfirmRegen(true)}
            disabled={regenerating}
            className="mt-3 rounded-[10px] border border-accent-border bg-accent-soft px-3 py-1.5 text-xs font-semibold text-accent disabled:opacity-50"
          >
            {regenerating ? 'Gerando…' : 'Gerar resumo'}
          </button>
        </div>
      )}

      {state.status === 'ready' && state.summary && (
        <>
          {/* Chip de IA + o que ele significa: conteúdo inferido é sempre
              distinguível e revisável (ADR-002, DESIGN.md §6). */}
          <div className="flex items-center gap-3 rounded-[14px] border border-border2 bg-surface px-4 py-3">
            <span className="shrink-0 rounded-full border border-accent-border px-2.5 py-1 font-mono text-[9px] uppercase tracking-[0.08em] text-accent">
              Inferido por IA · {state.summary.provider}
            </span>
            <span className="flex-1 text-[12.5px] leading-relaxed text-muted">
              Resumo gerado a partir da documentação do repositório. O que o humano
              escreveu tem prioridade sobre o que a máquina inferiu.
            </span>
            <button
              onClick={() => setConfirmRegen(true)}
              disabled={regenerating}
              className="h-[34px] shrink-0 rounded-[10px] border border-border2 px-3 text-xs font-semibold text-body2 transition-colors duration-150 hover:border-hoverb hover:text-text disabled:opacity-50"
            >
              {regenerating ? 'Gerando…' : 'Regenerar'}
            </button>
          </div>

          <div className="grid gap-3 lg:grid-cols-2">
            <Block title="O que é" icon={<IconInfo />} text={state.summary.content.oQueE} />
            <Block
              title="Onde parou"
              icon={<IconClock />}
              text={state.summary.content.ondeParou}
            />
          </div>

          <section className="rounded-[14px] border border-border2 bg-surface p-5">
            <div className="mb-3 flex items-center gap-2">
              <span className="text-accent">
                <IconList />
              </span>
              <h2 className="text-sm font-semibold text-text">O que falta</h2>
            </div>
            <ol className="grid gap-2.5 lg:grid-cols-2">
              {state.summary.content.oQueFalta.map((item, i) => (
                <li
                  key={i}
                  className="flex gap-2.5 rounded-[10px] bg-surface2 px-3.5 py-3 text-[12.5px] leading-relaxed text-body"
                >
                  <span className="shrink-0 font-mono text-[10px] text-faint">
                    {String(i + 1).padStart(2, '0')}
                  </span>
                  {item}
                </li>
              ))}
            </ol>
          </section>
        </>
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

function Block({
  title,
  icon,
  text,
}: {
  title: string;
  icon: React.ReactNode;
  text: string;
}) {
  return (
    <div className="rounded-[14px] border border-border2 bg-surface p-5">
      <div className="mb-2 flex items-center gap-2">
        <span className="text-accent">{icon}</span>
        <h2 className="text-sm font-semibold text-text">{title}</h2>
      </div>
      <p className="text-[12.5px] leading-relaxed text-body">{text}</p>
    </div>
  );
}

function SummarySkeleton() {
  return (
    <div className="space-y-3">
      <div className="grid gap-3 lg:grid-cols-2">
        <div className="h-32 animate-pulse rounded-[14px] bg-card" />
        <div className="h-32 animate-pulse rounded-[14px] bg-card" />
      </div>
      <div className="h-40 animate-pulse rounded-[14px] bg-card" />
    </div>
  );
}

/**
 * Faixa de gasto de IA (SPEC-009). Só aparece quando passou do alerta ou bateu
 * o teto — silenciosa dentro do orçamento (sinal, não ruído).
 */
function UsageAlert({ usage }: { usage: CurrentMonthUsage }) {
  const spent = Number(usage.costUsd);
  const alert = Number(usage.alertUsd);
  const overAlert = alert > 0 && spent >= alert;
  if (!usage.blocked && !overAlert) return null;

  const color = usage.blocked ? 'var(--error)' : 'var(--warning)';
  const money = (v: string) => `$${Number(v).toFixed(2)}`;
  return (
    <div
      className="flex items-center gap-2 rounded-[10px] px-4 py-2.5 text-sm"
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

function IconInfo() {
  return (
    <svg
      aria-hidden
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M12 8v4M12 16h.01" />
    </svg>
  );
}

function IconClock() {
  return (
    <svg
      aria-hidden
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 3" />
    </svg>
  );
}

function IconList() {
  return (
    <svg
      aria-hidden
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M3 6h18M7 12h14M11 18h10" />
    </svg>
  );
}
