import { useEffect, useState } from 'react';
import { api, LlmProvider, Settings as SettingsData } from '../lib/api';

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

export function Settings({ onClose }: Props) {
  const [state, setState] = useState<State>({ status: 'loading' });
  const [saving, setSaving] = useState(false);

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
        className="w-full max-w-lg rounded-lg border border-border bg-surface p-6 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-semibold">Configurações</h2>
          <button
            onClick={onClose}
            className="text-text-muted transition-colors duration-150 hover:text-text"
          >
            ✕
          </button>
        </div>

        {state.status === 'loading' && (
          <div className="h-40 animate-pulse rounded-md bg-border/50" />
        )}
        {state.status === 'error' && (
          <p className="text-sm text-error">{state.message}</p>
        )}
        {state.status === 'ready' && (
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
          </div>
        )}
      </div>
    </div>
  );
}
