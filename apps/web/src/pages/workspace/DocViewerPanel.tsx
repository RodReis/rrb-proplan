import { useEffect, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { api, DocumentContent } from '../../lib/api';

interface Props {
  projectId: string;
  /** Path do doc; null = nó-fantasma (link quebrado), sem conteúdo. */
  path: string | null;
  onClose: () => void;
}

type State =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; doc: DocumentContent };

/** Painel lateral que abre o documento clicado no grafo (SPEC-004). */
export function DocViewerPanel({ projectId, path, onClose }: Props) {
  const [state, setState] = useState<State>({ status: 'idle' });

  useEffect(() => {
    if (path === null) {
      setState({ status: 'idle' });
      return;
    }
    let active = true;
    setState({ status: 'loading' });
    api
      .documentContent(projectId, path)
      .then((doc) => active && setState({ status: 'ready', doc }))
      .catch(
        (err) => active && setState({ status: 'error', message: String(err) }),
      );
    return () => {
      active = false;
    };
  }, [projectId, path]);

  return (
    <aside className="absolute right-0 top-0 z-20 flex h-full w-[420px] flex-col border-l border-border bg-surface shadow-lg">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <span className="truncate text-sm font-medium">
          {path ?? 'Documento ausente'}
        </span>
        <button
          onClick={onClose}
          className="text-text-muted transition-colors duration-150 hover:text-text"
        >
          ✕
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {path === null && (
          <p className="text-sm text-text-muted">
            Este documento é referenciado mas não existe no repositório (link
            quebrado).
          </p>
        )}
        {state.status === 'loading' && (
          <div className="h-40 animate-pulse rounded-md bg-border/50" />
        )}
        {state.status === 'error' && (
          <p className="text-sm text-error">{state.message}</p>
        )}
        {state.status === 'ready' && (
          <article className="prose-doc">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>
              {state.doc.content}
            </ReactMarkdown>
          </article>
        )}
      </div>
    </aside>
  );
}
