import { useEffect, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { toast } from 'sonner';
import { api, Entity } from '../../lib/api';

interface Props {
  projectId: string;
  tab: Entity;
  initialContent: string;
  onClose: () => void;
  onPromoted: () => void;
}

/**
 * Editor de promoção do conteúdo inferido por IA (nível 3/4) a documento real
 * (Task 12, Fatia 7). Reusa o padrão visual do BootstrapDialog (Fatia 3):
 * textarea font-mono + toggle Preview (ReactMarkdown + remarkGfm).
 */
export function PromoteDialog({ projectId, tab, initialContent, onClose, onPromoted }: Props) {
  const [content, setContent] = useState(initialContent);
  const [preview, setPreview] = useState(false);
  const [promoting, setPromoting] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  async function promote() {
    setPromoting(true);
    try {
      await api.promote(projectId, tab, content);
      toast.success('Documento promovido — sincronizando…');
      onPromoted();
    } catch (err) {
      toast.error(`Falha ao promover: ${err}`);
    } finally {
      setPromoting(false);
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
          <h2 className="text-sm font-semibold">Promover a documento</h2>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPreview((p) => !p)}
              className="rounded-md border border-border px-2.5 py-1 text-xs hover:border-brand hover:text-brand"
            >
              {preview ? 'Editar' : 'Preview'}
            </button>
            <button onClick={onClose} className="text-text-muted hover:text-text" aria-label="Fechar">
              ✕
            </button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-auto p-5">
          {preview ? (
            <article className="prose-doc">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
            </article>
          ) : (
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              spellCheck={false}
              className="h-full w-full resize-none rounded-md border border-border bg-bg p-3 font-mono text-xs"
            />
          )}
        </div>

        <div className="flex justify-end gap-2 border-t border-border px-5 py-3">
          <button
            onClick={onClose}
            className="rounded-md border border-border px-3 py-1.5 text-xs font-semibold hover:bg-bg"
          >
            Cancelar
          </button>
          <button
            onClick={() => void promote()}
            disabled={promoting || content.trim() === ''}
            className="rounded-md border border-brand bg-brand px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-50"
          >
            {promoting ? 'Promovendo…' : 'Promover e commitar'}
          </button>
        </div>
      </div>
    </div>
  );
}
