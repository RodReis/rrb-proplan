import { useEffect, useState } from 'react';
import { api, CurrentMonthUsage, ModelPrice, UsageReport } from '../lib/api';

/** Tradução dos kind de inferência para linguagem de gente (mesma da CONVENTION). */
const KIND_LABEL: Record<string, string> = {
  summary: 'Resumo do projeto',
  status_bootstrap: 'Proposta de backlog',
  architecture_fallback: 'Arquitetura inferida',
  design_fallback: 'Design inferido',
  edges_marker: 'Ligações entre documentos',
  classify_marker: 'Classificação de documentos',
};
const STATUS_LABEL: Record<string, string> = {
  ok: 'Concluídas',
  error: 'Com erro',
  discarded: 'Descartadas',
};

const usd = (v: string) => `$${Number(v).toFixed(4)}`;
const usd2 = (v: string) => `$${Number(v).toFixed(2)}`;

/**
 * Tela de Consumo de IA (SPEC-009, Fatia 7.5). Mês corrente com barra até o
 * alerta/teto, quebras, taxa de desperdício e aviso de preço ausente. Todos os
 * números vêm do SUM bruto do banco — sem conta própria na UI.
 */
export function UsageTab() {
  const [month, setMonth] = useState<CurrentMonthUsage | null>(null);
  const [report, setReport] = useState<UsageReport | null>(null);
  const [prices, setPrices] = useState<ModelPrice[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([api.usageCurrentMonth(), api.usageReport(), api.modelPrices()])
      .then(([m, r, p]) => {
        setMonth(m);
        setReport(r);
        setPrices(p);
      })
      .catch(() => void 0)
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="h-64 animate-pulse rounded-md bg-border/50" />;
  if (!month || !report) return <p className="text-sm text-error">Não foi possível carregar o consumo.</p>;

  const spent = Number(month.costUsd);
  const cap = Number(month.capUsd);
  const alert = Number(month.alertUsd);
  const overAlert = alert > 0 && spent >= alert;
  const pctOfCap = cap > 0 ? Math.min(100, (spent / cap) * 100) : 0;
  const waste = Number(report.wasteRatePct);

  return (
    <div className="space-y-6">
      {/* Mês corrente — barra até alerta/teto */}
      <section>
        <div className="mb-2 flex items-baseline justify-between">
          <h3 className="text-sm font-medium">Gasto do mês</h3>
          <span className="text-lg font-semibold tabular-nums">{usd2(month.costUsd)}</span>
        </div>

        {cap > 0 ? (
          <>
            <div className="relative h-2.5 overflow-hidden rounded-full bg-bg">
              <div
                className="h-full rounded-full transition-all"
                style={{
                  width: `${pctOfCap}%`,
                  background: month.blocked
                    ? 'var(--color-error)'
                    : overAlert
                      ? 'var(--color-warning)'
                      : 'var(--color-success)',
                }}
              />
              {/* marcador do alerta */}
              {alert > 0 && alert < cap && (
                <div
                  className="absolute top-0 h-full w-px bg-text/40"
                  style={{ left: `${(alert / cap) * 100}%` }}
                  title={`Alerta em ${usd2(month.alertUsd)}`}
                />
              )}
            </div>
            <div className="mt-1.5 flex justify-between text-xs text-text-muted tabular-nums">
              <span>alerta {usd2(month.alertUsd)}</span>
              <span>teto {usd2(month.capUsd)}</span>
            </div>
          </>
        ) : (
          <p className="text-xs text-text-muted">Teto desligado (0) — sem bloqueio de gasto.</p>
        )}

        {month.blocked && (
          <p
            className="mt-3 rounded-md px-3 py-2 text-xs"
            style={{ background: 'color-mix(in oklab, var(--color-error) 8%, transparent)', color: 'var(--color-error)' }}
          >
            Teto de gasto atingido ({usd2(month.costUsd)}/{usd2(month.capUsd)}) — nenhuma nova
            chamada de IA será feita este mês. Ajuste o teto acima para destravar.
          </p>
        )}

        {/* Aviso de preço ausente — AO LADO da barra do teto, não escondido (SPEC-009) */}
        {month.missingPriceCount > 0 && (
          <p
            className="mt-3 rounded-md px-3 py-2 text-xs"
            style={{ background: 'color-mix(in oklab, var(--color-warning) 8%, transparent)', color: 'var(--color-warning)' }}
          >
            {month.missingPriceCount} chamada{month.missingPriceCount > 1 ? 's' : ''} sem preço
            cadastrado — o custo real é maior que o exibido, e o teto protege menos do que promete.
          </p>
        )}
      </section>

      {/* Resumo do período */}
      <section className="grid grid-cols-3 gap-3">
        <Stat label="Chamadas" value={String(report.totalCalls)} />
        <Stat label="Tokens" value={report.totalTokens.toLocaleString('pt-BR')} />
        <Stat
          label="Desperdício"
          value={`${waste}%`}
          tone={waste > 0 ? 'warning' : undefined}
          hint="% do custo em chamadas com erro ou descartadas"
        />
      </section>

      {/* Quebra por tipo */}
      {report.byKind.length > 0 && (
        <section>
          <h3 className="mb-2 text-sm font-medium">Por tipo de inferência</h3>
          <ul className="divide-y divide-border rounded-md border border-border">
            {report.byKind
              .slice()
              .sort((a, b) => Number(b.costUsd) - Number(a.costUsd))
              .map((r) => (
                <li key={r.kind} className="flex items-center justify-between px-3 py-2 text-sm">
                  <span>{KIND_LABEL[r.kind] ?? r.kind}</span>
                  <span className="flex items-center gap-3 text-text-muted tabular-nums">
                    <span className="text-xs">{r.calls}×</span>
                    <span className="text-text">{usd(r.costUsd)}</span>
                  </span>
                </li>
              ))}
          </ul>
        </section>
      )}

      {/* Quebra por status (só se houver erro/descarte) */}
      {report.byStatus.some((s) => s.status !== 'ok') && (
        <section>
          <h3 className="mb-2 text-sm font-medium">Por resultado</h3>
          <ul className="divide-y divide-border rounded-md border border-border">
            {report.byStatus.map((r) => (
              <li key={r.status} className="flex items-center justify-between px-3 py-2 text-sm">
                <span className={r.status !== 'ok' ? 'text-warning' : undefined}>
                  {STATUS_LABEL[r.status] ?? r.status}
                </span>
                <span className="flex items-center gap-3 text-text-muted tabular-nums">
                  <span className="text-xs">{r.calls}×</span>
                  <span className="text-text">{usd(r.costUsd)}</span>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Preços por modelo */}
      <section>
        <h3 className="mb-2 text-sm font-medium">Preços por modelo (USD por 1M tokens)</h3>
        {prices.length === 0 ? (
          <p className="text-xs text-text-muted">Nenhum preço cadastrado.</p>
        ) : (
          <div className="overflow-x-auto rounded-md border border-border">
            <table className="w-full text-xs">
              <thead className="bg-bg text-text-muted">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">Modelo</th>
                  <th className="px-3 py-2 text-right font-medium">Input</th>
                  <th className="px-3 py-2 text-right font-medium">Output</th>
                  <th className="px-3 py-2 text-right font-medium">Cache w/r</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {prices.map((p) => (
                  <tr key={p.id}>
                    <td className="px-3 py-2">
                      <span className="text-text-muted">{p.provider}/</span>
                      {p.model}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{usd2(p.inputPer1M)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{usd2(p.outputPer1M)}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-text-muted">
                      {usd2(p.cacheWritePer1M)} / {usd2(p.cacheReadPer1M)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-2 text-xs text-text-muted">
          Editar o preço cria uma nova vigência — o custo já registrado nunca é reescrito.
        </p>
      </section>
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
  hint,
}: {
  label: string;
  value: string;
  tone?: 'warning';
  hint?: string;
}) {
  return (
    <div className="rounded-md border border-border p-3" title={hint}>
      <div className="text-xs text-text-muted">{label}</div>
      <div
        className="mt-0.5 text-lg font-semibold tabular-nums"
        style={tone === 'warning' ? { color: 'var(--color-warning)' } : undefined}
      >
        {value}
      </div>
    </div>
  );
}
