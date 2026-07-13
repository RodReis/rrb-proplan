import { useCallback, useEffect, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  api,
  DocKind,
  DocumentContent,
  DocumentSummary,
  SyncRun,
} from '../../lib/api';
import { DocTree } from './DocTree';
import { useResizableWidth } from './useResizableWidth';

interface Props {
  projectId: string;
  /** Sinaliza que um sync foi disparado externamente (botão do header). */
  syncNonce: number;
}

type DocsState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; docs: DocumentSummary[] };

const SYNC_TERMINAL: SyncRun['status'][] = ['success', 'noop', 'failed'];
const POLL_MS = 1500;

export function DocumentsTab({ projectId, syncNonce }: Props) {
  const [state, setState] = useState<DocsState>({ status: 'loading' });
  const [run, setRun] = useState<SyncRun | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const { width, dragging, onMouseDown, onKeyDown } = useResizableWidth({
    storageKey: 'proplan.docs.panelWidth',
    initial: 440,
    min: 240,
    max: 720,
  });

  const loadDocs = useCallback(async () => {
    try {
      const docs = await api.documents(projectId);
      setState({ status: 'ready', docs });
      setSelected((prev) => prev ?? docs[0]?.path ?? null);
    } catch (err) {
      setState({ status: 'error', message: String(err) });
    }
  }, [projectId]);

  // Carga inicial + recarrega quando o header dispara um novo sync.
  useEffect(() => {
    void loadDocs();
    void api.latestSyncRun(projectId).then(setRun);
  }, [loadDocs, projectId, syncNonce]);

  // Polling enquanto o sync não terminou (SSE fica pra quando houver webhook).
  useEffect(() => {
    if (!run || SYNC_TERMINAL.includes(run.status)) return;
    const id = setInterval(async () => {
      const latest = await api.latestSyncRun(projectId);
      setRun(latest);
      if (latest && SYNC_TERMINAL.includes(latest.status)) void loadDocs();
    }, POLL_MS);
    return () => clearInterval(id);
  }, [run, projectId, loadDocs]);

  const isSyncing =
    run !== null && !SYNC_TERMINAL.includes(run.status);

  if (state.status === 'loading') return <DocsSkeleton />;

  if (state.status === 'error') {
    return (
      <ErrorState
        message={state.message}
        onRetry={() => {
          setState({ status: 'loading' });
          void loadDocs();
        }}
      />
    );
  }

  if (state.status === 'ready' && state.docs.length === 0) {
    return (
      <EmptyState
        isSyncing={isSyncing}
        failed={run?.status === 'failed' ? run.error : null}
      />
    );
  }

  const skipped = run?.status === 'success' ? run.skipped : 0;

  return (
    <div className={'flex h-full' + (dragging ? ' cursor-col-resize select-none' : '')}>
      <nav
        className="shrink-0 overflow-y-auto p-2"
        style={{ width }}
      >
        {isSyncing && (
          <div className="mb-2 rounded-md bg-brand/5 px-3 py-2 text-xs text-brand">
            Sincronizando…
          </div>
        )}
        <DocTree docs={state.docs} selected={selected} onSelect={setSelected} />
      </nav>

      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Redimensionar painel de documentos"
        tabIndex={0}
        onMouseDown={onMouseDown}
        onKeyDown={onKeyDown}
        className={
          'group relative w-px shrink-0 cursor-col-resize bg-border outline-none ' +
          'before:absolute before:inset-y-0 before:-left-1.5 before:-right-1.5 before:content-[""] ' + // área de clique confortável
          (dragging ? 'bg-brand' : 'hover:bg-brand/40 focus-visible:bg-brand')
        }
      >
        {/* pega discreta no meio, aparece no hover/drag */}
        <span
          aria-hidden
          className={
            'pointer-events-none absolute left-1/2 top-1/2 h-8 w-1 -translate-x-1/2 -translate-y-1/2 rounded-full transition-opacity duration-150 ' +
            (dragging ? 'bg-brand opacity-100' : 'bg-brand/50 opacity-0 group-hover:opacity-100')
          }
        />
      </div>

      <div className="flex-1 overflow-y-auto">
        {skipped > 0 && (
          <div className="border-b border-warning/30 bg-warning/5 px-8 py-2 text-xs text-warning">
            {skipped} arquivo(s) ignorado(s) por exceder 512 KB.
          </div>
        )}
        {selected ? (
          <DocumentViewer
            projectId={projectId}
            path={selected}
            kind={state.docs.find((d) => d.path === selected)?.kind ?? 'markdown'}
          />
        ) : (
          <p className="p-8 text-sm text-text-muted">
            Selecione um documento à esquerda.
          </p>
        )}
      </div>
    </div>
  );
}

type ViewerState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; doc: DocumentContent };

function DocumentViewer({
  projectId,
  path,
  kind,
}: {
  projectId: string;
  path: string;
  kind: DocKind;
}) {
  if (kind === 'pdf')
    return (
      <iframe
        src={api.rawUrl(projectId, path)}
        title={path}
        className="h-full w-full border-0"
      />
    );

  if (kind === 'image')
    return (
      <div className="flex h-full items-center justify-center overflow-auto bg-[repeating-conic-gradient(#f3f4f6_0_25%,#fff_0_50%)] bg-[length:20px_20px] p-8">
        <img
          src={api.rawUrl(projectId, path)}
          alt={path}
          className="max-h-full max-w-full"
        />
      </div>
    );

  if (kind === 'html')
    return (
      <div className="flex h-full flex-col">
        <div className="border-b border-border bg-warning/5 px-8 py-2 text-xs text-warning">
          Conteúdo isolado por segurança — scripts não são executados.
        </div>
        <iframe
          src={api.rawUrl(projectId, path)}
          title={path}
          sandbox=""
          className="flex-1 border-0"
        />
      </div>
    );

  if (kind === 'office') return <DocxViewer projectId={projectId} path={path} />;

  if (kind === 'binary')
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-8 text-center">
        <p className="text-sm font-medium">Pré-visualização não disponível</p>
        <p className="max-w-md text-xs text-text-muted">{path}</p>
      </div>
    );

  return <MarkdownDoc projectId={projectId} path={path} />;
}

function MarkdownDoc({
  projectId,
  path,
}: {
  projectId: string;
  path: string;
}) {
  const [state, setState] = useState<ViewerState>({ status: 'loading' });

  useEffect(() => {
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

  if (state.status === 'loading')
    return <div className="m-8 h-64 animate-pulse rounded-md bg-border/50" />;
  if (state.status === 'error')
    return (
      <div className="m-8 rounded-md border border-error/30 bg-error/5 p-4 text-sm text-error">
        Falha ao carregar {path}: {state.message}
      </div>
    );

  return (
    <article className="prose-doc max-w-3xl px-8 py-6">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>
        {state.doc.content}
      </ReactMarkdown>
    </article>
  );
}

function DocxViewer({
  projectId,
  path,
}: {
  projectId: string;
  path: string;
}) {
  const [state, setState] = useState<
    | { status: 'loading' }
    | { status: 'error'; message: string }
    | { status: 'ready'; text: string }
  >({ status: 'loading' });

  useEffect(() => {
    let active = true;
    setState({ status: 'loading' });
    api
      .docxText(projectId, path)
      .then((r) => active && setState({ status: 'ready', text: r.text }))
      .catch(
        (e) => active && setState({ status: 'error', message: String(e) }),
      );
    return () => {
      active = false;
    };
  }, [projectId, path]);

  if (state.status === 'loading')
    return <div className="m-8 h-64 animate-pulse rounded-md bg-border/50" />;
  if (state.status === 'error')
    return (
      <p className="m-8 text-sm text-error">
        Falha ao ler o documento: {state.message}
      </p>
    );
  return (
    <div className="px-8 py-6">
      <p className="mb-4 text-xs text-text-muted">
        Texto extraído — formatação e imagens omitidas.
      </p>
      <pre className="whitespace-pre-wrap font-sans text-sm text-text">
        {state.text}
      </pre>
    </div>
  );
}

function DocsSkeleton() {
  return (
    <div className="flex h-full">
      <div className="w-[440px] shrink-0 space-y-2 border-r border-border p-4">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-8 animate-pulse rounded-md bg-border/50" />
        ))}
      </div>
      <div className="flex-1 space-y-3 p-8">
        <div className="h-8 w-1/2 animate-pulse rounded-md bg-border/50" />
        <div className="h-4 w-full animate-pulse rounded-md bg-border/50" />
        <div className="h-4 w-5/6 animate-pulse rounded-md bg-border/50" />
      </div>
    </div>
  );
}

function EmptyState({
  isSyncing,
  failed,
}: {
  isSyncing: boolean;
  failed: string | null;
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 p-8 text-center">
      {isSyncing ? (
        <>
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-brand border-t-transparent" />
          <p className="text-sm text-text-muted">Sincronizando documentação…</p>
        </>
      ) : failed ? (
        <>
          <p className="text-sm font-medium text-error">Falha no sync</p>
          <p className="max-w-md text-xs text-text-muted">{failed}</p>
        </>
      ) : (
        <>
          <p className="text-sm font-medium">Nenhum documento encontrado</p>
          <p className="max-w-md text-xs text-text-muted">
            Este repositório não tem <code>docs/</code>, <code>README.md</code>{' '}
            nem <code>CLAUDE.md</code>. Adicione documentação e sincronize.
          </p>
        </>
      )}
    </div>
  );
}

function ErrorState({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
      <p className="text-sm font-medium text-error">
        Falha ao carregar documentos
      </p>
      <p className="max-w-md text-xs text-text-muted">{message}</p>
      <button
        onClick={onRetry}
        className="rounded-md border border-border px-3 py-1.5 text-xs font-semibold transition-colors duration-150 hover:border-brand hover:text-brand"
      >
        Tentar de novo
      </button>
    </div>
  );
}
