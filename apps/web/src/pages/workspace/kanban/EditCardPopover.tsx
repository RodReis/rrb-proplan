import { useState } from 'react';
import { BoardCard, IssuePriority, MutationInput } from '../../../lib/api';
import { ConfirmDialog } from '../../../components/ConfirmDialog';
import { PRIORITY_LABEL } from './columns';

interface Props {
  card: BoardCard;
  projectId: string;
  mutate: (input: MutationInput, cardNumber: number | null) => Promise<boolean>;
  onClose: () => void;
  onSaved: () => void;
}

const PRIORITIES: (IssuePriority | null)[] = ['alta', 'media', 'baixa', null];

/** Editar título/prioridade de um card ou descartá-lo (SPEC-005). */
export function EditCardPopover({ card, mutate, onClose, onSaved }: Props) {
  const [title, setTitle] = useState(card.title);
  const [priority, setPriority] = useState<IssuePriority | null>(card.priority);
  const [saving, setSaving] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);

  async function save() {
    setSaving(true);
    const ok = await mutate(
      {
        type: 'edit_card',
        number: card.number,
        title: title.trim() !== card.title ? title.trim() : undefined,
        priority: priority !== card.priority ? priority : undefined,
      },
      card.number,
    );
    setSaving(false);
    if (ok) onSaved();
  }

  async function discard() {
    setConfirmDiscard(false);
    const ok = await mutate({ type: 'discard_card', number: card.number }, card.number);
    if (ok) onSaved();
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-text/20 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-lg border border-border bg-surface p-5 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold">Editar card #{card.number}</h2>
          <button onClick={onClose} className="text-text-muted hover:text-text">
            ✕
          </button>
        </div>

        <label className="text-xs font-medium text-text-muted">Título</label>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="mb-3 mt-1 w-full rounded-md border border-border bg-bg px-3 py-2 text-sm outline-none focus:border-brand"
        />

        <label className="text-xs font-medium text-text-muted">Prioridade</label>
        <div className="mt-1 flex gap-2">
          {PRIORITIES.map((p) => (
            <button
              key={p ?? 'none'}
              onClick={() => setPriority(p)}
              className={
                'rounded-md border px-2.5 py-1 text-xs font-medium transition-colors ' +
                (priority === p
                  ? 'border-btnbg bg-btnbg/5 text-brand'
                  : 'border-border text-text-muted hover:border-brand/40')
              }
            >
              {p ? PRIORITY_LABEL[p] : 'nenhuma'}
            </button>
          ))}
        </div>

        <div className="mt-5 flex items-center justify-between">
          <button
            onClick={() => setConfirmDiscard(true)}
            className="text-xs font-semibold text-error hover:underline"
          >
            Descartar card
          </button>
          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="rounded-md border border-border px-3 py-1.5 text-xs font-semibold hover:bg-bg"
            >
              Cancelar
            </button>
            <button
              onClick={() => void save()}
              disabled={saving}
              className="rounded-md border border-btnbg bg-btnbg px-3 py-1.5 text-xs font-semibold text-btnfg hover:opacity-90 disabled:opacity-50"
            >
              {saving ? 'Salvando…' : 'Salvar'}
            </button>
          </div>
        </div>
      </div>

      {confirmDiscard && (
        <ConfirmDialog
          title="Descartar card"
          message={`Mover #${card.number} para Descartado? A issue é fechada (nunca deletada) e pode ser reaberta arrastando de volta.`}
          confirmLabel="Descartar"
          danger
          onConfirm={() => void discard()}
          onCancel={() => setConfirmDiscard(false)}
        />
      )}
    </div>
  );
}
