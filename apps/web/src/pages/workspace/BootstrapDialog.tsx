import { useEffect, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { api } from '../../lib/api';

interface Props {
  projectId: string;
  onClose: () => void;
  onCommitted: () => void;
}

type State =
  | { status: 'generating' }
  | { status: 'error'; message: string }
  | { status: 'editing' };

export function BootstrapDialog({ projectId, onClose, onCommitted }: Props) {
  const [state, setState] = useState<State>({ status: 'generating' });
  const [content, setContent] = useState('');
  const [preview, setPreview] = useState(false);
  const [committing, setCommitting] = useState(false);

  useEffect(() => {
    let active = true;
    api
      .proposeStatus(projectId)
      .then((r) => {
        if (!active) return;
        setContent(r.content);
        setState({ status: 'editing' });
      })
      .catch(
        (err) => active && setState({ status: 'error', message: String(err) }),
      );
    return () => {
      active = false;
    };
  }, [projectId]);

  async function commit() {
    setCommitting(true);
    try {
      await api.commitStatus(projectId, content);
      onCommitted();
    } catch (err) {
      setState({ status: 'error', message: String(err) });
    } finally {
      setCommitting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-text/20 p-4"
      onClick={onClose}
    >
      <div
        className="flex h-[80vh] w-full max-w-3xl flex-col rounded-lg border border-border bg-surface"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <h2 className="text-sm font-semibold">Proposta de STATUS.md</h2>
          <div className="flex items-center gap-2">
            {state.status === 'editing' && (
              <button
                onClick={() => setPreview((p) => !p)}
                className="rounded-md border border-border px-2.5 py-1 text-xs hover:border-brand hover:text-brand"
              >
                {preview ? 'Editar' : 'Preview'}
              </button>
            )}
            <button
              onClick={onClose}
              className="text-text-muted hover:text-text"
            >
              ✕
            </button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-auto p-5">
          {state.status === 'generating' && (
            <div className="flex h-full flex-col items-center justify-center gap-2">
              <div className="h-6 w-6 animate-spin rounded-full border-2 border-brand border-t-transparent" />
              <p className="text-sm text-text-muted">Gerando proposta…</p>
            </div>
          )}
          {state.status === 'error' && (
            <p className="text-sm text-error">{state.message}</p>
          )}
          {state.status === 'editing' &&
            (preview ? (
              <article className="prose-doc">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                  {content}
                </ReactMarkdown>
              </article>
            ) : (
              <textarea
                value={content}
                onChange={(e) => setContent(e.target.value)}
                spellCheck={false}
                className="h-full w-full resize-none rounded-md border border-border bg-bg p-3 font-mono text-xs"
              />
            ))}
        </div>

        {state.status === 'editing' && (
          <div className="flex justify-end gap-2 border-t border-border px-5 py-3">
            <button
              onClick={onClose}
              className="rounded-md border border-border px-3 py-1.5 text-xs font-semibold hover:bg-bg"
            >
              Cancelar
            </button>
            <button
              onClick={() => void commit()}
              disabled={committing || content.trim() === ''}
              className="rounded-md border border-brand bg-brand px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-50"
            >
              {committing ? 'Commitando…' : 'Aprovar e commitar'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
