import { useEffect, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { toast } from 'sonner';
import { api, Entity } from '../../lib/api';
import { OperationSteps, useOperation } from './OperationSteps';

interface Props {
  projectId: string;
  tab: Entity;
  initialContent: string;
  onClose: () => void;
  /** Chamado quando a operação de promoção conclui (a aba deve recarregar). */
  onPromoted: () => void;
}

/**
 * Editor de promoção do conteúdo inferido por IA (nível 3/4) a documento real
 * (Fatia 7). Ao commitar, entra em modo "operação em curso": mostra os passos
 * nomeados (SPEC-010) e recarrega a aba sozinho quando o sync termina — a tela
 * nunca fica igual e muda por baixo.
 */
export function PromoteDialog({ projectId, tab, initialContent, onClose, onPromoted }: Props) {
  const [content, setContent] = useState(initialContent);
  const [preview, setPreview] = useState(false);
  const [operationId, setOperationId] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);

  const op = useOperation(operationId, onPromoted);
  const running = operationId !== null && op?.status !== 'failed';

  useEffect(() => {
    // Esc só fecha enquanto edita — durante a operação, o commit já foi.
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !running && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, running]);

  async function promote() {
    setStarting(true);
    try {
      const { operationId } = await api.promote(projectId, tab, content);
      setOperationId(operationId);
    } catch (err) {
      toast.error(`Falha ao promover: ${err}`);
    } finally {
      setStarting(false);
    }
  }

  function retry() {
    setOperationId(null);
    void promote();
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-text/20 p-4"
      onClick={() => !running && onClose()}
    >
      <div
        className="flex h-[80vh] w-full max-w-3xl flex-col rounded-lg border border-border bg-surface"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <h2 className="text-sm font-semibold">Promover a documento</h2>
          {!operationId && (
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
          )}
        </div>

        <div className="min-h-0 flex-1 overflow-auto p-5">
          {operationId && op ? (
            <div className="mx-auto max-w-lg pt-6">
              <OperationSteps op={op} />
            </div>
          ) : preview ? (
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
          {op?.status === 'failed' ? (
            <>
              <button
                onClick={onClose}
                className="rounded-md border border-border px-3 py-1.5 text-xs font-semibold hover:bg-bg"
              >
                Fechar
              </button>
              <button
                onClick={retry}
                className="rounded-md border border-brand bg-brand px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90"
              >
                Tentar de novo
              </button>
            </>
          ) : (
            <>
              <button
                onClick={onClose}
                disabled={running}
                className="rounded-md border border-border px-3 py-1.5 text-xs font-semibold hover:bg-bg disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                onClick={() => void promote()}
                disabled={running || starting || content.trim() === ''}
                className="rounded-md border border-brand bg-brand px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-50"
              >
                {operationId ? 'Promovendo…' : starting ? 'Promovendo…' : 'Promover e commitar'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
