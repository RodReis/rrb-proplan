import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import {
  createBriefingLink,
  createClientProject,
  getBriefingLink,
  getBriefingStatus,
  getClient,
  revokeBriefingLink,
  type BriefingLinkInfo,
  type BriefingStatus,
  type Client,
  type ClientDetail,
  type ClientProject,
  type CreatedBriefingLink,
} from '../../lib/api';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { STATE_LABELS } from './boardView';
import { BriefingVersionPanel } from './BriefingVersionPanel';
import {
  briefingStateLabel,
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

const PROJECT_FLOW = ['Rascunho', 'Gerar link', 'Copiar link'];

function shortDate(value: string | null | undefined): string {
  if (!value) return 'sem expiração';

  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!match) return value;

  const [, year, month, day] = match;
  return `${day}/${month}/${year}`;
}

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
  const [briefingFor, setBriefingFor] = useState<ClientProject | null>(null);
  /** Estado do briefing por projeto (SPEC-031 §6). */
  const [briefings, setBriefings] = useState<Record<string, BriefingStatus>>({});

  const load = useCallback(async () => {
    try {
      const detail = await getClient(client.id);
      setState({ status: 'ready', detail });

      // Um GET por projeto, em paralelo. Falha de um não derruba a gaveta: a
      // lista de projetos é o conteúdo principal, o estado do briefing é
      // acessório — sem ele o rótulo cai em "não iniciado", que é o default
      // honesto.
      const results = await Promise.all(
        detail.projects.map((p) =>
          getBriefingStatus(p.id)
            .then((status) => [p.id, status] as const)
            .catch(() => null),
        ),
      );
      setBriefings(Object.fromEntries(results.filter((r) => r !== null)));
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
      toast.success('Projeto criado em Rascunho');
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
        <header className="flex items-start justify-between gap-3 border-b border-border2 bg-panel px-5 py-4">
          <div className="min-w-0">
            <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-faint">
              Cliente aberto
            </span>
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
                className="inline-flex h-8 items-center gap-1.5 rounded-[9px] bg-btnbg px-3 text-xs font-semibold text-btnfg transition-[filter] duration-150 hover:brightness-110"
              >
                <span aria-hidden className="text-sm leading-none">+</span>
                Novo projeto
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              aria-label="Fechar detalhe do cliente"
              className="grid h-8 w-8 place-items-center rounded-[8px] text-muted transition-colors duration-150 hover:bg-card hover:text-text"
            >
              ×
            </button>
          </div>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-4">
          <section className="rounded-[10px] border border-border bg-surface px-4 py-3">
            <div className="flex items-center justify-between gap-3">
              <h3 className="font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-faint">
                Fluxo do cliente
              </h3>
              <span className="rounded-full border border-border2 px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.08em] text-faint">
                {projects.length} {projects.length === 1 ? 'projeto' : 'projetos'}
              </span>
            </div>
            <ol className="mt-3 grid grid-cols-3 gap-2">
              {PROJECT_FLOW.map((step, index) => (
                <li
                  key={step}
                  className="rounded-[8px] border border-border2 bg-panel px-2.5 py-2"
                >
                  <span className="font-mono text-[10px] text-faint">
                    {String(index + 1).padStart(2, '0')}
                  </span>
                  <span className="mt-1 block text-[12px] font-medium leading-snug text-body2">
                    {step}
                  </span>
                </li>
              ))}
            </ol>
          </section>

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
              <p className="mt-1 break-words font-mono text-[11px] text-faint">
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
            <div className="mt-3 rounded-[10px] border border-dashed border-border3 bg-panel px-4 py-5">
              <p className="text-sm font-semibold text-text2">Nenhum projeto ainda.</p>
              <p className="mt-1 text-sm text-muted">
                {canWrite
                  ? 'O primeiro projeto cria o card do funil e libera o link de briefing.'
                  : 'O funil mostra os projetos deste cliente quando existirem.'}
              </p>
              {canWrite && (
                <button
                  type="button"
                  onClick={() => setCreating(true)}
                  className="mt-4 inline-flex h-8 items-center rounded-[9px] bg-btnbg px-3 text-xs font-semibold text-btnfg transition-[filter] duration-150 hover:brightness-110"
                >
                  Novo projeto
                </button>
              )}
            </div>
          )}

          {state.status === 'ready' && projects.length > 0 && (
            <ul className="mt-3 grid list-none gap-2.5 p-0">
              {projects.map((project) => (
                <li
                  key={project.id}
                  className="rounded-[10px] border border-border2 bg-surface px-4 py-3 transition-colors duration-150 hover:border-hoverb hover:bg-card/35"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="truncate text-sm font-semibold text-text2">
                          {project.title}
                        </span>
                        <span className="rounded-full border border-border2 bg-panel px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.08em] text-faint">
                          {STATE_LABELS[project.state]}
                        </span>
                      </div>
                      <p className="mt-1 line-clamp-2 text-xs text-body2">
                        {project.description || 'Sem descrição registrada.'}
                      </p>
                      <p className="mt-2 font-mono text-[10px] uppercase tracking-[0.08em] text-faint">
                        Criado em {shortDate(project.createdAt)} ·{' '}
                        {briefingStateLabel(briefings[project.id] ?? null)}
                      </p>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1.5">
                      {canWrite && (
                        <button
                          type="button"
                          onClick={() => setLinkFor(project)}
                          className="rounded-[8px] border border-accent-border px-3 py-1.5 text-xs font-semibold text-text2 transition-colors duration-150 hover:bg-accent-soft"
                        >
                          Link de briefing
                        </button>
                      )}
                      {/* Sem `canWrite`: `viewer` lê o briefing (spec §6). */}
                      {(briefings[project.id]?.versions.length ?? 0) > 0 && (
                        <button
                          type="button"
                          onClick={() => setBriefingFor(project)}
                          className="rounded-[8px] bg-btnbg px-3 py-1.5 text-xs font-semibold text-btnfg transition-[filter] duration-150 hover:brightness-110"
                        >
                          Ver briefing
                        </button>
                      )}
                    </div>
                  </div>
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

      {briefingFor && briefings[briefingFor.id] && (
        <BriefingVersionPanel
          versions={briefings[briefingFor.id].versions}
          projectTitle={briefingFor.title}
          onClose={() => setBriefingFor(null)}
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
  const titleId = 'new-project-title';
  const descriptionId = 'new-project-description';

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
        className="w-full max-w-xl overflow-hidden rounded-[12px] border border-border2 bg-pop shadow-lg"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
      >
        <header className="border-b border-border px-5 py-4">
          <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-faint">
            Projeto do cliente
          </span>
          <h2 id={titleId} className="mt-1 text-base font-semibold text-text2">
            Novo projeto
          </h2>
          <p id={descriptionId} className="mt-1 text-xs text-muted">
            {clientName} · Rascunho · link ainda não gerado
          </p>
        </header>

        <div className="grid gap-4 px-5 py-4">
          <label className="block text-xs font-medium text-muted">
            Título *
            <input
              autoFocus
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
              className="mt-1 h-10 w-full rounded-[9px] border border-border2 bg-panel px-3 text-sm text-text outline-none transition-colors duration-150 placeholder:text-muted focus:border-hoverb"
              placeholder="Ex.: Site institucional EPG"
            />
          </label>

          <label className="block text-xs font-medium text-muted">
            Descrição
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="mt-1 min-h-[96px] w-full resize-y rounded-[9px] border border-border2 bg-panel px-3 py-2 text-sm text-text outline-none transition-colors duration-150 placeholder:text-muted focus:border-hoverb"
              placeholder="Escopo inicial, objetivo ou observação comercial."
            />
          </label>
        </div>

        <div className="flex justify-end gap-2 border-t border-border bg-panel px-5 py-4">
          <button
            type="button"
            onClick={onCancel}
            className="h-9 rounded-[9px] border border-border2 px-3 text-xs font-semibold text-body transition-colors duration-150 hover:bg-surface-hover"
          >
            Cancelar
          </button>
          <button
            type="submit"
            disabled={!isValidTitle(title)}
            className="h-9 rounded-[9px] bg-btnbg px-4 text-xs font-semibold text-btnfg transition-[filter] duration-150 hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
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
  const [copied, setCopied] = useState(false);

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
      setCopied(false);
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
      setCopied(true);
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
      data-testid="briefing-link-backdrop"
      onClick={() => {
        if (!created) onClose();
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === 'Escape' && !created) onClose();
        }}
        className="w-full max-w-xl overflow-hidden rounded-[12px] border border-border2 bg-pop shadow-lg"
        role="dialog"
        aria-modal="true"
        aria-label="Link de briefing"
      >
        <header className="flex items-start justify-between gap-3 border-b border-border px-5 py-4">
          <div className="min-w-0">
            <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-faint">
              Briefing público
            </span>
            <h2 className="mt-1 text-base font-semibold text-text2">Link de briefing</h2>
            <p className="mt-0.5 truncate text-xs text-muted">{project.title}</p>
          </div>
          <span className="shrink-0 rounded-full border border-accent-border bg-accent-soft px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.08em] text-text2">
            {LINK_STATE_LABEL[state]}
          </span>
        </header>

        <div className="grid gap-4 px-5 py-4">
          {!created && (
            <div className="rounded-[10px] border border-border bg-panel px-4 py-3">
              <p className="text-sm font-semibold text-text2">
                {state === 'nenhum' ? 'Nenhum link ativo para este projeto.' : 'Link já existe para este projeto.'}
              </p>
              <p className="mt-1 text-xs text-muted">
                {state === 'nenhum'
                  ? 'Gerar cria uma URL pública para o briefing do cliente.'
                  : 'Regenerar invalida a URL anterior e entrega uma nova.'}
              </p>
            </div>
          )}

        {created && (
          <div className="rounded-[10px] border border-warning bg-surface2 px-4 py-3">
            <p className="text-sm font-semibold text-warning-strong">
              Copie agora — este link não será exibido novamente.
            </p>
            <p className="mt-1 text-xs text-body2">
              Só o hash é guardado no banco. Se esta janela for fechada sem copiar,
              a saída é regenerar e invalidar o anterior.
            </p>
            {/* O link já é o definitivo, mas hoje responde JSON: o formulário
                público é a fatia seguinte (SPEC-029 → Fora de escopo). Sem este
                aviso, quem abrir para conferir acha que está quebrado. */}
            <p className="mt-1 text-xs text-muted">
              O formulário de briefing é a próxima fatia — por enquanto o link
              abre uma página confirmando que ele é válido.
            </p>
            <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_auto]">
              <input
                readOnly
                value={briefingUrl(created.token, window.location.origin)}
                onFocus={(e) => e.currentTarget.select()}
                className="h-10 min-w-0 rounded-[9px] border border-border2 bg-panel px-3 font-mono text-[11px] text-text"
              />
              <button
                type="button"
                onClick={() => void copy(briefingUrl(created.token, window.location.origin))}
                className="h-10 rounded-[9px] bg-btnbg px-4 text-xs font-semibold text-btnfg transition-[filter] duration-150 hover:brightness-110"
              >
                {copied ? 'Copiado' : 'Copiar link'}
              </button>
            </div>
          </div>
        )}

        {info?.active && (
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 rounded-[10px] border border-border bg-panel px-4 py-3 text-xs">
            <dt className="text-faint">criado em</dt>
            <dd className="text-body2">{shortDate(info.createdAt)}</dd>
            <dt className="text-faint">expira em</dt>
            <dd className="text-body2">{shortDate(info.expiresAt)}</dd>
          </dl>
        )}

        <label className="block text-xs font-medium text-muted">
          Expiração (opcional)
          <input
            type="date"
            value={expiresAt}
            onChange={(e) => setExpiresAt(e.target.value)}
            className="mt-1 h-10 w-full rounded-[9px] border border-border2 bg-panel px-3 text-sm text-text outline-none transition-colors duration-150 focus:border-hoverb"
          />
        </label>
        </div>

        <div className="flex flex-wrap justify-end gap-2 border-t border-border bg-panel px-5 py-4">
          <button
            type="button"
            onClick={onClose}
            className="h-9 rounded-[9px] border border-border2 px-3 text-xs font-semibold text-body transition-colors duration-150 hover:bg-surface-hover"
          >
            Fechar
          </button>
          {canRevoke(state) && (
            <button
              type="button"
              disabled={busy}
              onClick={() => void revoke()}
              className="h-9 rounded-[9px] border border-error/40 px-3 text-xs font-semibold text-error transition-colors duration-150 hover:bg-surface-hover disabled:opacity-50"
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
            className="h-9 rounded-[9px] bg-btnbg px-4 text-xs font-semibold text-btnfg transition-[filter] duration-150 hover:brightness-110 disabled:opacity-50"
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
