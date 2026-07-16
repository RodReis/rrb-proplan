import type { DeployVerdictState, Freshness } from '../../lib/api';

interface Props {
  freshness: Freshness | null;
  /** Nº de cards na coluna Feito — a fila de aceite do dono (ADR-011). */
  awaitingAcceptance: number | null;
  lastSyncAt: string | null;
  deployVerdict: DeployVerdictState | null;
}

type Tone = 'neutral' | 'accent' | 'success' | 'warning';

interface Signal {
  label: string;
  value: string;
  sub: string;
  tone: Tone;
}

/**
 * Os 4 sinais do topo da Visão Geral (protótipo `ProPlan Workspace.dc.html`).
 *
 * **Exceção registrada ao "sem hero-metric"** do PRODUCT.md (decisão do PI em
 * 2026-07-16): o padrão é banido como decoração de SaaS, mas aqui cada sinal é
 * um fato datado que responde uma pergunta de gestão — e nenhum deles é
 * inventado ou composto (ADR-012 proíbe score de saúde). Vale só nesta faixa;
 * não é licença para número grande em outra aba.
 *
 * Sem dado, o sinal diz que não sabe — nunca finge zero (ADR-014).
 */
export function OverviewSignals({
  freshness,
  awaitingAcceptance,
  lastSyncAt,
  deployVerdict,
}: Props) {
  const signals: Signal[] = [
    docsVsCode(freshness),
    acceptance(awaitingAcceptance),
    lastSync(lastSyncAt),
    deployDrift(deployVerdict),
  ];

  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {signals.map((s) => (
        <div
          key={s.label}
          className="rounded-[14px] border border-border2 bg-surface px-4 py-3.5"
        >
          <div className="font-mono text-[9px] uppercase tracking-[0.14em] text-faint">
            {s.label}
          </div>
          <div
            className="mt-1.5 text-[19px] font-semibold tracking-[-0.01em]"
            style={{ color: toneColor(s.tone) }}
          >
            {s.value}
          </div>
          <div className="mt-0.5 text-[11.5px] text-muted">{s.sub}</div>
        </div>
      ))}
    </div>
  );
}

function toneColor(tone: Tone): string {
  if (tone === 'success') return 'var(--success)';
  if (tone === 'warning') return 'var(--warning)';
  if (tone === 'accent') return 'var(--accent)';
  return 'var(--text)';
}

/** Frescor (ADR-010): o alerta é âmbar, nunca vermelho — não bloqueia nada. */
function docsVsCode(f: Freshness | null): Signal {
  if (!f) return unknown('Docs · código', 'sem dado de commits ainda');
  const docs = relativeDate(f.lastDocsCommitAt);
  const code = relativeDate(f.lastCodeCommitAt);
  return {
    label: 'Docs · código',
    value: `${docs} · ${code}`,
    sub: f.stale
      ? `código à frente dos docs por mais de ${f.thresholdDays} d`
      : 'sem divergência detectada',
    tone: f.stale ? 'warning' : 'neutral',
  };
}

/**
 * Feito é fila de aceite, não conquista (DESIGN.md §6). Com entregas paradas
 * ali, o sinal é ação pendente **do dono** — prata, não urgência falsa.
 */
function acceptance(n: number | null): Signal {
  if (n === null) return unknown('Aguardando seu aceite', 'board indisponível');
  return {
    label: 'Aguardando seu aceite',
    value: n === 0 ? 'nada' : `${n} entrega${n > 1 ? 's' : ''}`,
    sub: n === 0 ? 'coluna Feito vazia' : 'entregue, aguardando seu aceite',
    tone: n > 0 ? 'accent' : 'neutral',
  };
}

function lastSync(iso: string | null): Signal {
  if (!iso)
    return {
      label: 'Última sincronização',
      value: 'nunca',
      sub: 'sincronize para popular o workspace',
      tone: 'neutral',
    };
  return {
    label: 'Última sincronização',
    value: relativeTime(iso),
    sub: 'automática, do repositório',
    tone: 'neutral',
  };
}

/** SPEC-013: o veredito é confronto de fontes, não opinião. */
function deployDrift(v: DeployVerdictState | null): Signal {
  const map: Record<DeployVerdictState, { value: string; sub: string; tone: Tone }> = {
    concordam: { value: 'nenhum', sub: 'produção documentada', tone: 'success' },
    discordam: {
      value: 'divergente',
      sub: 'as fontes discordam — ver aba Deploy',
      tone: 'warning',
    },
    so_github_side: {
      value: 'só no GitHub',
      sub: 'sinal de deploy sem doc fresca',
      tone: 'warning',
    },
    omissa: { value: 'sem doc', sub: 'deploy existe, documentação não', tone: 'warning' },
    silencio: { value: 'silêncio', sub: 'nenhuma fonte de deploy', tone: 'neutral' },
  };
  if (!v) return unknown('Drift de deploy', 'ainda não coletado');
  const hit = map[v];
  return { label: 'Drift de deploy', ...hit };
}

/** Ausência é informação (ADR-014): dizer "—" é honesto; fingir zero, não. */
function unknown(label: string, sub: string): Signal {
  return { label, value: '—', sub, tone: 'neutral' };
}

function relativeDate(iso: string | null): string {
  if (!iso) return '—';
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days < 1) return 'hoje';
  if (days < 30) return `há ${days} d`;
  const months = Math.floor(days / 30);
  if (months < 12) return `há ${months} ${months > 1 ? 'meses' : 'mês'}`;
  return `há ${Math.floor(months / 12)} a`;
}

function relativeTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return 'agora';
  const min = Math.floor(ms / 60_000);
  if (min < 1) return 'agora';
  if (min < 60) return `há ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `há ${h} h`;
  return `há ${Math.floor(h / 24)} d`;
}
