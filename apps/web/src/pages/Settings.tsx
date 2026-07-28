import { useEffect, useState } from 'react';
import { api, LlmProvider, Settings as SettingsData, TenantCaps } from '../lib/api';
import { UsageTab } from './UsageTab';

interface Props {
  onClose: () => void;
}

const PROVIDER_LABELS: Record<LlmProvider, string> = {
  anthropic: 'Anthropic',
  openai: 'OpenAI',
  openrouter: 'OpenRouter',
};

type State =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; data: SettingsData };

type Tab = 'general' | 'usage';

export function Settings({ onClose }: Props) {
  const [state, setState] = useState<State>({ status: 'loading' });
  const [saving, setSaving] = useState(false);
  const [tab, setTab] = useState<Tab>('general');

  useEffect(() => {
    api
      .settings()
      .then((data) => setState({ status: 'ready', data }))
      .catch((err) => setState({ status: 'error', message: String(err) }));
  }, []);

  async function save(patch: Partial<SettingsData>) {
    if (state.status !== 'ready') return;
    setSaving(true);
    try {
      const updated = await api.updateSettings(patch);
      setState({ status: 'ready', data: updated });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-text/20 p-4"
      onClick={onClose}
    >
      <div
        className="flex max-h-[85vh] w-full max-w-lg flex-col rounded-lg border border-border bg-surface shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border px-6 pt-5">
          <div className="flex gap-1">
            {(['general', 'usage'] as Tab[]).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={
                  'rounded-t-md px-3 py-2 text-sm transition-colors ' +
                  (tab === t
                    ? 'font-semibold text-brand'
                    : 'text-text-muted hover:text-text')
                }
              >
                {t === 'general' ? 'Configurações' : 'Uso de IA'}
              </button>
            ))}
          </div>
          <button
            onClick={onClose}
            className="text-text-muted transition-colors duration-150 hover:text-text"
          >
            ✕
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-6">
        {tab === 'usage' && <UsageTab />}
        {tab === 'general' && state.status === 'loading' && (
          <div className="h-40 animate-pulse rounded-md bg-border/50" />
        )}
        {tab === 'general' && state.status === 'error' && (
          <p className="text-sm text-error">{state.message}</p>
        )}
        {tab === 'general' && state.status === 'ready' && (
          <div className="space-y-6">
            <section>
              <h3 className="mb-2 text-sm font-medium">Provedor de IA</h3>
              <div className="space-y-2">
                {(['anthropic', 'openai', 'openrouter'] as LlmProvider[]).map(
                  (p) => {
                    const enabled = state.data.availableProviders.includes(p);
                    const active = state.data.llmProvider === p;
                    return (
                      <button
                        key={p}
                        disabled={!enabled || saving}
                        onClick={() => void save({ llmProvider: p })}
                        title={enabled ? undefined : 'Sem chave no .env'}
                        className={
                          'flex w-full items-center justify-between rounded-md border px-3 py-2 text-sm transition-colors duration-150 ' +
                          (active
                            ? 'border-brand bg-brand/5 font-medium text-brand'
                            : enabled
                              ? 'border-border hover:border-brand/40'
                              : 'cursor-not-allowed border-border text-text-muted/50')
                        }
                      >
                        <span>{PROVIDER_LABELS[p]}</span>
                        {active && <span>✓</span>}
                        {!enabled && (
                          <span className="text-[10px]">sem chave</span>
                        )}
                      </button>
                    );
                  },
                )}
              </div>
            </section>

            <section>
              <h3 className="mb-1 text-sm font-medium">
                Alerta de documentação defasada
              </h3>
              <p className="mb-2 text-xs text-text-muted">
                Avisar quando o código estiver à frente dos docs por mais de N
                dias. Use <code>0</code> para desligar o alerta.
              </p>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min={0}
                  defaultValue={state.data.docsStalenessThresholdDays}
                  disabled={saving}
                  onBlur={(e) => {
                    const v = Number(e.target.value);
                    if (
                      Number.isInteger(v) &&
                      v >= 0 &&
                      v !== state.data.docsStalenessThresholdDays
                    ) {
                      void save({ docsStalenessThresholdDays: v });
                    }
                  }}
                  className="w-24 rounded-md border border-border px-3 py-1.5 text-sm"
                />
                <span className="text-sm text-text-muted">dias</span>
              </div>
            </section>

            <TenantCapsSection />
          </div>
        )}
        </div>
      </div>
    </div>
  );
}

/**
 * Teto de gasto de IA do TENANT (ADR-026). Carrega de `/settings/llm-caps`, não
 * de `/settings`: o dono do dado é outro — aquilo é preferência de pessoa, isto
 * é o bolso do tenant.
 *
 * Quem não é `owner` vê os números e não os edita. Mostrar campo editável a
 * quem a API vai recusar seria botão morto — e pior que morto: um que parece
 * ter salvado.
 */
export function TenantCapsSection() {
  const [caps, setCaps] = useState<TenantCaps | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api
      .llmCaps()
      .then(setCaps)
      .catch((err) => setError(String(err)));
  }, []);

  async function saveCaps(patch: Partial<TenantCaps>) {
    setSaving(true);
    setError(null);
    try {
      setCaps(await api.updateLlmCaps(patch));
    } catch (err) {
      // Sem isto, uma recusa do servidor deixaria o número velho na tela e o
      // usuário acharia que salvou.
      setError(String(err));
      setCaps(await api.llmCaps());
    } finally {
      setSaving(false);
    }
  }

  if (error && !caps) {
    return (
      <section>
        <h3 className="mb-1 text-sm font-medium">Teto de gasto de IA</h3>
        <p className="text-xs text-danger">{error}</p>
      </section>
    );
  }
  if (!caps) return null;

  const field = (
    label: string,
    value: string,
    key: 'llmAlertUsdMonthly' | 'llmHardCapUsdMonthly',
  ) => (
    <label className="flex flex-col gap-1 text-xs text-text-muted">
      {label}
      <div className="flex items-center gap-1.5">
        <span className="text-text-muted">$</span>
        {caps.canEditCaps ? (
          <input
            type="number"
            min={0}
            step="0.01"
            defaultValue={value}
            disabled={saving}
            onBlur={(e) => {
              const v = e.target.value;
              if (Number(v) >= 0 && v !== value) void saveCaps({ [key]: v });
            }}
            className="w-24 rounded-md border border-border px-3 py-1.5 text-sm tabular-nums"
          />
        ) : (
          <span className="w-24 px-3 py-1.5 text-sm tabular-nums">{value}</span>
        )}
      </div>
    </label>
  );

  return (
    <section>
      <h3 className="mb-1 text-sm font-medium">Teto de gasto de IA</h3>
      <p className="mb-2 text-xs text-text-muted">
        USD por mês, somando todos os provedores. Ao passar do <strong>teto</strong>,
        nenhuma chamada de IA é feita até alguém ajustar. Use <code>0</code> no teto
        para desligar o bloqueio. O limite é <strong>do workspace</strong>, não seu —
        vale para todos os membros.
      </p>
      {!caps.canEditCaps && (
        <p className="mb-2 text-xs text-text-muted">
          Só o dono do workspace altera o teto.
        </p>
      )}
      <div className="flex flex-wrap items-end gap-4">
        {field('Alerta (âmbar)', caps.llmAlertUsdMonthly, 'llmAlertUsdMonthly')}
        {field('Teto (bloqueia)', caps.llmHardCapUsdMonthly, 'llmHardCapUsdMonthly')}
      </div>
      {error && <p className="mt-2 text-xs text-danger">{error}</p>}
    </section>
  );
}
