import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { api, CardToCreate } from '../../../lib/api';
import { COLUMN_LABEL } from './columns';

interface Props {
  projectId: string;
  onClose: () => void;
  onCreated: () => void;
}

type State =
  | { status: 'proposing' }
  | { status: 'error'; message: string }
  | { status: 'review'; cards: CardToCreate[] };

/**
 * Bootstrap do backlog por IA (SPEC-005): propõe cards a partir da doc, o
 * usuário revisa (pode remover) e aprova → cria as issues. Nunca cria sem
 * aprovação — substitui o antigo bootstrap de STATUS.md por IA.
 */
export function BootstrapDialog({ projectId, onClose, onCreated }: Props) {
  const [state, setState] = useState<State>({ status: 'proposing' });
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    let active = true;
    api
      .proposeCards(projectId)
      .then((cards) => active && setState({ status: 'review', cards }))
      .catch((err) => active && setState({ status: 'error', message: String(err) }));
    return () => {
      active = false;
    };
  }, [projectId]);

  function removeCard(index: number) {
    if (state.status !== 'review') return;
    setState({
      status: 'review',
      cards: state.cards.filter((_, i) => i !== index),
    });
  }

  async function create() {
    if (state.status !== 'review') return;
    setCreating(true);
    try {
      const { created } = await api.applyBootstrap(projectId, state.cards);
      toast.success(`${created} issues criadas.`);
      onCreated();
    } catch (err) {
      toast.error(`Falha ao criar: ${err}`);
    } finally {
      setCreating(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-text/20 p-4"
      onClick={onClose}
    >
      <div
        className="flex max-h-[80vh] w-full max-w-lg flex-col rounded-lg border border-border bg-surface"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <h2 className="text-sm font-semibold">Backlog proposto por IA</h2>
          <button onClick={onClose} className="text-text-muted hover:text-text">
            ✕
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-auto p-3">
          {state.status === 'proposing' && (
            <div className="flex h-40 flex-col items-center justify-center gap-2">
              <div className="h-6 w-6 animate-spin rounded-full border-2 border-brand border-t-transparent" />
              <p className="text-sm text-text-muted">Propondo cards…</p>
            </div>
          )}
          {state.status === 'error' && (
            <p className="p-4 text-sm text-error">{state.message}</p>
          )}
          {state.status === 'review' &&
            state.cards.map((c, i) => (
              <div
                key={i}
                className="flex items-center justify-between border-b border-border/50 px-2 py-1.5 text-sm last:border-0"
              >
                <span>{c.title}</span>
                <div className="flex items-center gap-3">
                  <span className="text-xs text-text-muted">
                    {COLUMN_LABEL[c.column]}
                    {c.priority ? ` · ${c.priority}` : ''}
                  </span>
                  <button
                    onClick={() => removeCard(i)}
                    className="text-xs text-text-muted hover:text-error"
                    title="Remover da proposta"
                  >
                    ✕
                  </button>
                </div>
              </div>
            ))}
        </div>

        {state.status === 'review' && (
          <div className="flex justify-end gap-2 border-t border-border px-5 py-3">
            <button
              onClick={onClose}
              className="rounded-md border border-border px-3 py-1.5 text-xs font-semibold hover:bg-bg"
            >
              Cancelar
            </button>
            <button
              onClick={() => void create()}
              disabled={creating || state.cards.length === 0}
              className="rounded-md border border-brand bg-brand px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-50"
            >
              {creating ? 'Criando…' : `Criar ${state.cards.length} issues`}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
