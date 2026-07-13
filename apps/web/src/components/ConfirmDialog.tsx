import { useEffect } from 'react';

interface Props {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Destrutivo → botão de confirmar em vermelho (descarte, remoção). */
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Diálogo de confirmação no padrão do DESIGN.md (overlay + card + ações),
 * substituto do window.confirm nativo. Fecha no Esc e no clique fora.
 */
export function ConfirmDialog({
  title,
  message,
  confirmLabel = 'Confirmar',
  cancelLabel = 'Cancelar',
  danger = false,
  onConfirm,
  onCancel,
}: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onCancel();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-text/20 p-4"
      onClick={onCancel}
    >
      <div
        className="w-full max-w-sm rounded-lg border border-border bg-surface p-5 shadow-lg"
        onClick={(e) => e.stopPropagation()}
        role="alertdialog"
        aria-modal="true"
        aria-label={title}
      >
        <h2 className="text-sm font-semibold">{title}</h2>
        <p className="mt-2 text-sm text-text-muted">{message}</p>
        <div className="mt-5 flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="rounded-md border border-border px-3 py-1.5 text-xs font-semibold hover:bg-bg"
          >
            {cancelLabel}
          </button>
          <button
            onClick={onConfirm}
            autoFocus
            className={
              danger
                ? 'rounded-md border border-error bg-error px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90'
                : 'rounded-md border border-brand bg-brand px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90'
            }
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
