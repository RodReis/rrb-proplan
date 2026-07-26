import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import {
  createBriefingLink,
  createClientProject,
  getBriefingLink,
  getClient,
  revokeBriefingLink,
  type BriefingLinkInfo,
  type Client,
  type ClientDetail,
  type ClientProject,
  type CreatedBriefingLink,
} from '../../lib/api';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { STATE_LABELS } from './boardView';
import {
  briefingUrl,
  canRevoke,
  generateLabel,
  isValidTitle,
  linkStateOf,
  LINK_STATE_LABEL,
  sortProjects,
} from './clientDetailView';

interface Props {
  client: Client;
  canWrite: boolean;
  onClose: () => void;
  /** Projeto criado/alterado ⇒ o funil e a lista atrás precisam recarregar. */
  onChanged: () => void;
}

type State =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; detail: ClientDetail };

/**
 * Detalhe do cliente (FIX #134): lista os projetos dele e é **a porta de entrada
 * do funil** — sem isto, `client_projects` fica vazio para sempre e o Kanban não
 * tem card nenhum, que é exatamente o defeito que esta correção fecha.
 *
 * O critério de aceite da SPEC-029 é literal: *"os dois projetos listam no
 * detalhe do cliente; ambos nascem em `DRAFT`, coluna Novo/Link enviado"*.
 */
export function ClientDetailPanel({ client, canWrite, onClose, onChanged }: Props) {
  const [state, setState] = useState<State>({ status: 'loading' });
  const [creating, setCreating] = useState(false);
  const [linkFor, setLinkFor] = useState<ClientProject | null>(null);

  const load = useCallback(async () => {
    try {
      setState({ status: 'ready', detail: await getClient(client.id) });
    } catch (err) {
      setState({
        status: 'error',
        message: err instanceof Error ? err.message : 'falha ao carregar',
      });
    }
  }, [client.id]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  async function handleCreate(input: { title: string; description: string | null }) {
    try {
      const project = await createClientProject(client.id, input);
      setCreating(false);
      toast.success('Projeto criado em Novo / Link enviado');
      await load();
      // O funil atrás mostra este card agora — recarregar lá também.
      onChanged();
      // Emenda ao §2 da spec: o link nasce junto com o projeto. Abrir o painel
      // já aqui evita que "gerar link" fique um passo escondido.
      setLinkFor(project);
    } catch {
      toast.error('Não foi possível criar o projeto');
    }
  }

  const projects =
    state.status === 'ready' ? sortProjects(state.detail.projects) : [];

  return (
    <>
      <div className="fixed inset-0 z-40 bg-text/20" onClick={onClose} aria-hidden="true" />
      <aside
        className="card-drawer"
        role="dialog"
        aria-modal="true"
        aria-label={`Cliente ${client.name}`}
      >
        <header className="flex items-start justify-between gap-3 border-b border-border2 px-5 py-4">
          <div className="min-w-0">
            <h2 className="text-base font-semibold leading-snug text-text2">
              {client.name}
            </h2>
            <p className="mt-0.5 text-xs text-muted">
              {[client.company, client.email].filter(Boolean).join(' · ') ||
                'sem empresa nem e-mail'}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {canWrite && (
              <button
                type="button"
                onClick={() => setCreating(true)}
                className="rounded-md border border-accent-border px-3 py-1.5 text-xs font-semibold text-text2 transition-colors duration-150 hover:bg-surface-hover"
              >
                + Novo projeto
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              aria-label="Fechar detalhe do cliente"
              className="px-1 text-muted transition-colors duration-150 hover:text-text"
            >
              ✕
            </button>
          </div>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-4">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-dim">
            Projetos
          </h3>

          {state.status === 'loading' && (
            <div className="mt-3 space-y-2">
              <div className="h-16 animate-pulse rounded-md bg-surface-hover" />
              <div className="h-16 animate-pulse rounded-md bg-surface-hover" />
            </div>
          )}

          {state.status === 'error' && (
            <div className="mt-3 rounded-md border border-warning bg-surface px-4 py-3">
              <p className="text-sm font-semibold text-warning-strong">
                Não foi possível carregar os projetos.
              </p>
              <p className="mt-1 break-words font-mono text-[11px] text-dim">
                {state.message}
              </p>
              <button
                type="button"
                onClick={() => void load()}
                className="mt-3 rounded-md border border-border2 px-3 py-1.5 text-xs font-semibold text-text2 hover:bg-surface-hover"
              >
                Tentar de novo
              </button>
            </div>
          )}

          {state.status === 'ready' && projects.length === 0 && (
            <p className="mt-3 text-sm text-muted">
              Nenhum projeto ainda.{' '}
              {canWrite
                ? 'Crie o primeiro para ele aparecer no funil.'
                : 'O funil mostra os projetos deste cliente quando existirem.'}
            </p>
          )}

          {state.status === 'ready' && projects.length > 0 && (
            <ul className="mt-3 grid list-none gap-2 p-0">
              {projects.map((project) => (
                <li
                  key={project.id}
                  className="rounded-md border border-border bg-surface px-4 py-3"
                >
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="text-sm font-semibold text-text2">
                      {project.title}
                    </span>
                    <span className="rounded-full border border-border2 px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.08em] text-faint">
                      {STATE_LABELS[project.state]}
                    </span>
                  </div>
                  {project.description && (
                    <p className="mt-1 text-xs text-body2">{project.description}</p>
                  )}
                  {canWrite && (
                    <button
                      type="button"
                      onClick={() => setLinkFor(project)}
                      className="mt-2 text-xs font-semibold text-accent hover:underline"
                    >
                      Link de briefing
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </aside>

      {creating && (
        <NewProjectDialog
          clientName={client.name}
          onCancel={() => setCreating(false)}
          onSubmit={(input) => void handleCreate(input)}
        />
      )}

      {linkFor && (
        <BriefingLinkDialog
          project={linkFor}
          onClose={() => {
            setLinkFor(null);
            void load();
            onChanged();
          }}
        />
      )}
    </>
  );
}

/** Título + descrição. O projeto nasce em `DRAFT` — o estado não se escolhe. */
function NewProjectDialog({
  clientName,
  onCancel,
  onSubmit,
}: {
  clientName: string;
  onCancel: () => void;
  onSubmit: (input: { title: string; description: string | null }) => void;
}) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-text/20 p-4"
      onClick={onCancel}
    >
      <form
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.key === 'Escape' && onCancel()}
        onSubmit={(e) => {
          e.preventDefault();
          if (!isValidTitle(title)) return;
          onSubmit({ title: title.trim(), description: description.trim() || null });
        }}
        className="w-full max-w-md rounded-lg border border-border bg-surface p-5 shadow-lg"
        role="dialog"
        aria-modal="true"
        aria-label="Novo projeto"
      >
        <h2 className="text-sm font-semibold text-text2">Novo projeto</h2>
        <p className="mt-0.5 text-xs text-muted">
          Para {clientName}. Nasce em <strong>Rascunho</strong>, na coluna Novo /
          Link enviado.
        </p>

        <label className="mt-4 block text-xs font-medium text-muted">
          Título *
          <input
            autoFocus
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
            className="mt-1 w-full rounded-md border border-border2 bg-panel px-3 py-2 text-sm text-text outline-none focus:border-hoverb"
          />
        </label>

        <label className="mt-3 block text-xs font-medium text-muted">
          Descrição
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="mt-1 min-h-[80px] w-full resize-y rounded-md border border-border2 bg-panel px-3 py-2 text-sm text-text outline-none focus:border-hoverb"
          />
        </label>

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md border border-border2 px-3 py-1.5 text-xs font-semibold text-body hover:bg-surface-hover"
          >
            Cancelar
          </button>
          <button
            type="submit"
            disabled={!isValidTitle(title)}
            className="rounded-md bg-btnbg px-3 py-1.5 text-xs font-semibold text-btnfg disabled:opacity-50"
          >
            Criar projeto
          </button>
        </div>
      </form>
    </div>
  );
}

/**
 * Ciclo de vida do link (SPEC-029 §2) — consome o backend do PR-3, que até aqui
 * não tinha UI nenhuma.
 *
 * **O token aparece uma única vez**, na resposta do POST. Nem o `getBriefingLink`
 * nem o banco o devolvem depois (só o hash SHA-256 persiste), então se o usuário
 * fechar sem copiar, a única saída é regenerar — e o aviso na tela diz isso.
 */
function BriefingLinkDialog({
  project,
  onClose,
}: {
  project: ClientProject;
  onClose: () => void;
}) {
  const [info, setInfo] = useState<BriefingLinkInfo | null>(null);
  const [created, setCreated] = useState<CreatedBriefingLink | null>(null);
  const [expiresAt, setExpiresAt] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmRegenerate, setConfirmRegenerate] = useState(false);

  const load = useCallback(async () => {
    try {
      setInfo(await getBriefingLink(project.id));
    } catch {
      setInfo({ active: false });
    }
  }, [project.id]);

  useEffect(() => {
    void load();
  }, [load]);

  const state = linkStateOf(info);

  async function generate() {
    setConfirmRegenerate(false);
    setBusy(true);
    try {
      // `expiresAt` vem de um <input type="date"> (nativo, sem lib de calendário
      // — o navegador já resolve isso). Vazio = sem expiração.
      const link = await createBriefingLink(
        project.id,
        expiresAt ? new Date(`${expiresAt}T23:59:59`).toISOString() : null,
      );
      setCreated(link);
      toast.success('Link gerado — copie agora, ele não é exibido de novo');
      await load();
    } catch {
      toast.error('Não foi possível gerar o link');
    } finally {
      setBusy(false);
    }
  }

  async function revoke() {
    setBusy(true);
    try {
      await revokeBriefingLink(project.id);
      setCreated(null);
      toast.success('Link revogado');
      await load();
    } catch {
      toast.error('Não foi possível revogar');
    } finally {
      setBusy(false);
    }
  }

  async function copy(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      toast.success('Link copiado');
    } catch {
      // Clipboard bloqueado (sem HTTPS, permissão negada): o campo é selecionável,
      // então dá para copiar à mão. Falhar em silêncio esconderia a saída.
      toast.error('Copie manualmente do campo acima');
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-text/20 p-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-lg rounded-lg border border-border bg-surface p-5 shadow-lg"
        role="dialog"
        aria-modal="true"
        aria-label="Link de briefing"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-text2">Link de briefing</h2>
            <p className="mt-0.5 truncate text-xs text-muted">{project.title}</p>
          </div>
          <span className="shrink-0 rounded-full border border-border2 px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.08em] text-faint">
            {LINK_STATE_LABEL[state]}
          </span>
        </div>

        {created && (
          <div className="mt-4 rounded-md border border-warning bg-surface2 px-4 py-3">
            <p className="text-xs font-semibold text-warning-strong">
              Copie agora — este link não será exibido novamente.
            </p>
            <p className="mt-1 text-[11px] text-body2">
              Só o hash é guardado no banco. Perdido, a única saída é regenerar
              (o que invalida o anterior).
            </p>
            <input
              readOnly
              value={briefingUrl(created.token, window.location.origin)}
              onFocus={(e) => e.currentTarget.select()}
              className="mt-2 w-full rounded-md border border-border2 bg-panel px-3 py-2 font-mono text-[11px] text-text"
            />
            <button
              type="button"
              onClick={() => void copy(briefingUrl(created.token, window.location.origin))}
              className="mt-2 rounded-md bg-btnbg px-3 py-1.5 text-xs font-semibold text-btnfg"
            >
              Copiar link
            </button>
          </div>
        )}

        {info?.active && (
          <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 rounded-md border border-border bg-panel px-4 py-3 text-xs">
            <dt className="text-dim">criado em</dt>
            <dd className="text-body2">{info.createdAt.slice(0, 10)}</dd>
            <dt className="text-dim">expira em</dt>
            <dd className="text-body2">
              {info.expiresAt ? info.expiresAt.slice(0, 10) : 'sem expiração'}
            </dd>
          </dl>
        )}

        <label className="mt-4 block text-xs font-medium text-muted">
          Expiração (opcional)
          <input
            type="date"
            value={expiresAt}
            onChange={(e) => setExpiresAt(e.target.value)}
            className="mt-1 w-full rounded-md border border-border2 bg-panel px-3 py-2 text-sm text-text outline-none focus:border-hoverb"
          />
        </label>

        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-border2 px-3 py-1.5 text-xs font-semibold text-body hover:bg-surface-hover"
          >
            Fechar
          </button>
          {canRevoke(state) && (
            <button
              type="button"
              disabled={busy}
              onClick={() => void revoke()}
              className="rounded-md border border-error/40 px-3 py-1.5 text-xs font-semibold text-error hover:bg-surface-hover disabled:opacity-50"
            >
              Revogar
            </button>
          )}
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              state === 'nenhum' ? void generate() : setConfirmRegenerate(true)
            }
            className="rounded-md bg-btnbg px-3 py-1.5 text-xs font-semibold text-btnfg disabled:opacity-50"
          >
            {generateLabel(state)}
          </button>
        </div>
      </div>

      {confirmRegenerate && (
        <ConfirmDialog
          title="Regenerar link?"
          message="O link atual deixa de funcionar imediatamente. Quem já o recebeu precisará do novo."
          confirmLabel="Regenerar"
          danger
          onConfirm={() => void generate()}
          onCancel={() => setConfirmRegenerate(false)}
        />
      )}
    </div>
  );
}
