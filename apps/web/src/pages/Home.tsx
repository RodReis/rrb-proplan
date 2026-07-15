import { motion } from 'framer-motion';
import { useCallback, useEffect, useState } from 'react';
import {
  api,
  CatalogInstallations,
  InstallationGroup,
  Project,
  Repo,
  SessionUser,
} from '../lib/api';
import { Settings } from './Settings';
import { Workspace } from './workspace/Workspace';

interface Props {
  user: SessionUser;
  onLogout: () => void;
}

type CatalogState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; data: CatalogInstallations };

export function Home({ user, onLogout }: Props) {
  const [catalog, setCatalog] = useState<CatalogState>({ status: 'loading' });
  const [projects, setProjects] = useState<Project[]>([]);
  const [busyRepoId, setBusyRepoId] = useState<number | null>(null);
  const [openProjectId, setOpenProjectId] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const load = useCallback(() => {
    setCatalog({ status: 'loading' });
    Promise.all([api.installations(), api.projects()])
      .then(([data, projs]) => {
        setCatalog({ status: 'ready', data });
        setProjects(projs);
      })
      .catch((err) => setCatalog({ status: 'error', message: String(err) }));
  }, []);

  useEffect(() => load(), [load]);

  async function toggleManaged(repo: Repo) {
    if (catalog.status !== 'ready') return;
    setBusyRepoId(repo.githubRepoId);
    try {
      if (repo.managedProjectId) {
        await api.removeProject(repo.managedProjectId);
      } else {
        await api.addProject(repo);
      }
      // Recarrega para refletir managedProjectId e o installationStatus.
      const [data, projs] = await Promise.all([api.installations(), api.projects()]);
      setCatalog({ status: 'ready', data });
      setProjects(projs);
    } finally {
      setBusyRepoId(null);
    }
  }

  async function openInstall() {
    const { url } = await api.installUrl();
    window.location.href = url;
  }

  const openProject = projects.find((p) => p.id === openProjectId) ?? null;

  return (
    <div className="flex h-screen bg-bg">
      {/* Rail de ícones */}
      <aside className="flex w-14 shrink-0 flex-col items-center border-r border-border bg-surface py-4">
        <div className="mb-6 flex h-8 w-8 items-center justify-center rounded-md bg-brand text-sm font-bold text-white">
          P
        </div>
        <button
          onClick={() => setSettingsOpen(true)}
          title="Configurações"
          className="mt-auto flex h-9 w-9 items-center justify-center rounded-md text-text-muted transition-colors duration-150 hover:bg-bg hover:text-text"
        >
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
        </button>
        <div className="mt-3">
          {user.avatarUrl && (
            <img
              src={user.avatarUrl}
              alt={user.login}
              className="h-8 w-8 rounded-full border border-border"
            />
          )}
        </div>
      </aside>
      {settingsOpen && <Settings onClose={() => setSettingsOpen(false)} />}

      {/* Sidebar contextual: projetos gerenciados */}
      <aside className="flex w-64 shrink-0 flex-col border-r border-border bg-surface">
        <div className="border-b border-border p-4">
          <div className="text-sm font-semibold">Projetos gerenciados</div>
          <div className="text-xs text-text-muted">{projects.length} projetos</div>
        </div>
        <nav className="flex-1 overflow-y-auto p-2">
          {projects.map((p) => {
            const isOpen = p.id === openProjectId;
            const missing = p.installationStatus === 'missing';
            return (
              <button
                key={p.id}
                onClick={() => setOpenProjectId(p.id)}
                className={
                  'group relative block w-full rounded-md px-3 py-2 text-left text-sm transition-colors duration-150 ' +
                  (isOpen ? 'bg-bg' : 'hover:bg-bg')
                }
              >
                <span
                  className={
                    'absolute left-0 top-1/2 w-0.5 -translate-y-1/2 rounded bg-brand transition-all duration-150 ' +
                    (isOpen ? 'h-4' : 'h-0 group-hover:h-4')
                  }
                />
                <div className="flex flex-wrap items-center gap-1.5 font-medium">
                  {p.name}
                  {missing && (
                    <span
                      title="App removido deste repositório — escritas desabilitadas"
                      className="rounded-full bg-warning/15 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-warning"
                    >
                      sem instalação
                    </span>
                  )}
                  {p.needsIssueImport && (
                    <span
                      title="Tem um STATUS.md legado — importar como Issues no Kanban"
                      className="rounded-full bg-brand/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-brand"
                    >
                      importar
                    </span>
                  )}
                  {p.deployVerdict === 'discordam' && (
                    <span
                      title="As fontes de deploy discordam sobre a plataforma — ver aba Deploy"
                      className="rounded-full bg-error/15 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-error"
                    >
                      deploy divergente
                    </span>
                  )}
                  {(p.deployVerdict === 'so_github_side' ||
                    p.deployVerdict === 'omissa') && (
                    <span
                      title="Sinal de deploy no GitHub sem fonte fresca ou sem doc — ver aba Deploy"
                      className="rounded-full bg-warning/15 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-warning"
                    >
                      deploy?
                    </span>
                  )}
                </div>
                <div className="truncate text-xs text-text-muted">{p.owner}</div>
              </button>
            );
          })}
          {projects.length === 0 && (
            <p className="px-3 py-2 text-xs text-text-muted">
              Nenhum projeto ainda — marque repos no catálogo ao lado.
            </p>
          )}
        </nav>
        <button
          onClick={onLogout}
          className="border-t border-border p-4 text-left text-xs text-text-muted transition-colors duration-150 hover:text-text"
        >
          Sair ({user.login})
        </button>
      </aside>

      {/* Conteúdo: workspace do projeto aberto ou catálogo por instalação */}
      {openProject ? (
        <main className="min-h-0 min-w-0 flex-1">
          <Workspace
            key={openProject.id}
            project={{
              owner: openProject.owner,
              name: openProject.name,
              managedProjectId: openProject.id,
            }}
            onBack={() => setOpenProjectId(null)}
          />
        </main>
      ) : (
        <main className="min-w-0 flex-1 overflow-y-auto">
          <header className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-bg/80 px-8 py-5 backdrop-blur">
            <div>
              <h1 className="text-lg font-semibold">Catálogo</h1>
              <p className="text-sm text-text-muted">
                Repositórios onde o ProPlan (GitHub App) está instalado.
              </p>
            </div>
            {catalog.status === 'ready' && !catalog.data.empty && (
              <button
                onClick={() => void openInstall()}
                className="shrink-0 rounded-md border border-border px-3 py-1.5 text-xs font-semibold text-text-muted transition-all duration-150 hover:border-brand/40 hover:text-brand"
              >
                Instalar em mais repositórios
              </button>
            )}
          </header>

          <div className="space-y-8 p-8">
            {catalog.status === 'loading' && <SkeletonList />}
            {catalog.status === 'error' && (
              <div className="rounded-md border border-error/30 bg-error/5 p-4 text-sm text-error">
                Falha ao listar instalações: {catalog.message}
              </div>
            )}
            {catalog.status === 'ready' && catalog.data.empty && (
              <EmptyInstall onInstall={() => void openInstall()} />
            )}
            {catalog.status === 'ready' &&
              catalog.data.groups.map((group) => (
                <AccountGroup
                  key={group.installationId}
                  group={group}
                  busyRepoId={busyRepoId}
                  onToggle={(r) => void toggleManaged(r)}
                  onInstall={() => void openInstall()}
                />
              ))}
          </div>
        </main>
      )}
    </div>
  );
}

function AccountGroup({
  group,
  busyRepoId,
  onToggle,
  onInstall,
}: {
  group: InstallationGroup;
  busyRepoId: number | null;
  onToggle: (repo: Repo) => void;
  onInstall: () => void;
}) {
  return (
    <section>
      <div className="mb-3 flex items-center gap-2">
        <h2 className="text-sm font-semibold">{group.account}</h2>
        <span className="rounded-full border border-border px-2 py-0.5 text-[10px] uppercase tracking-wide text-text-muted">
          {group.accountType === 'Organization' ? 'organização' : 'pessoal'}
        </span>
      </div>
      {group.repos.length === 0 ? (
        <div className="rounded-md border border-border bg-surface p-4 text-sm text-text-muted">
          Nenhum repositório acessível nesta conta —{' '}
          <button
            onClick={onInstall}
            className="font-semibold text-brand underline-offset-2 hover:underline"
          >
            revisar seleção no GitHub
          </button>
          .
        </div>
      ) : (
        <ul className="grid gap-3">
          {group.repos.map((repo, i) => (
            <motion.li
              key={repo.githubRepoId}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{
                duration: 0.2,
                delay: Math.min(i * 0.04, 0.4),
                ease: [0.16, 1, 0.3, 1],
              }}
              className="group flex items-center justify-between rounded-lg border border-border bg-surface p-4 transition-all duration-150 hover:-translate-y-0.5 hover:border-brand/30 hover:shadow-sm"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm font-semibold">
                    {repo.owner}/{repo.name}
                  </span>
                  {repo.isPrivate && (
                    <span className="rounded-full border border-border px-2 py-0.5 text-[10px] text-text-muted">
                      privado
                    </span>
                  )}
                </div>
                <p className="truncate text-xs text-text-muted">
                  {repo.description ?? 'Sem descrição'}
                  {repo.pushedAt &&
                    ` · último push ${new Date(repo.pushedAt).toLocaleDateString('pt-BR')}`}
                </p>
              </div>
              <button
                onClick={() => onToggle(repo)}
                disabled={busyRepoId === repo.githubRepoId}
                className={
                  repo.managedProjectId
                    ? 'ml-4 shrink-0 rounded-md border border-brand bg-brand/5 px-3 py-1.5 text-xs font-semibold text-brand transition-all duration-150 hover:bg-brand/10 disabled:opacity-50'
                    : 'ml-4 shrink-0 rounded-md border border-border px-3 py-1.5 text-xs font-semibold text-text-muted transition-all duration-150 hover:border-brand/40 hover:text-brand disabled:opacity-50'
                }
              >
                {busyRepoId === repo.githubRepoId
                  ? '…'
                  : repo.managedProjectId
                    ? '✓ Gerenciado'
                    : 'Gerenciar'}
              </button>
            </motion.li>
          ))}
        </ul>
      )}
    </section>
  );
}

function EmptyInstall({ onInstall }: { onInstall: () => void }) {
  return (
    <div className="mx-auto max-w-md rounded-xl border border-border bg-surface p-8 text-center">
      <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-lg bg-brand/10 text-2xl">
        📦
      </div>
      <h2 className="text-base font-semibold">
        O ProPlan ainda não está instalado em nenhum repositório
      </h2>
      <p className="mt-2 text-sm text-text-muted">
        Instale o GitHub App nos repositórios que você quer gerenciar. Você
        escolhe quais — o ProPlan só enxerga esses.
      </p>
      <button
        onClick={onInstall}
        className="mt-5 rounded-md bg-brand px-4 py-2 text-sm font-semibold text-white transition-colors duration-150 hover:bg-brand/90"
      >
        Instalar no GitHub
      </button>
    </div>
  );
}

function SkeletonList() {
  return (
    <ul className="grid gap-3">
      {Array.from({ length: 6 }).map((_, i) => (
        <li
          key={i}
          className="h-[72px] animate-pulse rounded-lg border border-border bg-surface"
        />
      ))}
    </ul>
  );
}
