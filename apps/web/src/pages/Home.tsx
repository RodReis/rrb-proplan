import { motion } from 'framer-motion';
import { useEffect, useState } from 'react';
import { api, Repo, SessionUser } from '../lib/api';
import { Settings } from './Settings';
import { Workspace } from './workspace/Workspace';

interface Props {
  user: SessionUser;
  onLogout: () => void;
}

type ReposState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; repos: Repo[] };

export function Home({ user, onLogout }: Props) {
  const [state, setState] = useState<ReposState>({ status: 'loading' });
  const [busyRepoId, setBusyRepoId] = useState<number | null>(null);
  const [openProjectId, setOpenProjectId] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);

  useEffect(() => {
    api
      .repos()
      .then((repos) => setState({ status: 'ready', repos }))
      .catch((err) => setState({ status: 'error', message: String(err) }));
  }, []);

  async function toggleManaged(repo: Repo) {
    if (state.status !== 'ready') return;
    setBusyRepoId(repo.githubRepoId);
    try {
      let updated: Repo;
      if (repo.managedProjectId) {
        await api.removeProject(repo.managedProjectId);
        updated = { ...repo, managedProjectId: null };
      } else {
        const project = await api.addProject(repo);
        updated = { ...repo, managedProjectId: project.id };
      }
      setState({
        status: 'ready',
        repos: state.repos.map((r) =>
          r.githubRepoId === repo.githubRepoId ? updated : r,
        ),
      });
    } finally {
      setBusyRepoId(null);
    }
  }

  const managed =
    state.status === 'ready'
      ? state.repos.filter((r) => r.managedProjectId)
      : [];

  const openProject =
    openProjectId !== null
      ? managed.find((r) => r.managedProjectId === openProjectId) ?? null
      : null;

  return (
    <div className="flex h-screen bg-bg">
      {/* Rail de ícones */}
      <aside className="flex w-14 flex-col items-center border-r border-border bg-surface py-4">
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
      <aside className="flex w-64 flex-col border-r border-border bg-surface">
        <div className="border-b border-border p-4">
          <div className="text-sm font-semibold">Projetos gerenciados</div>
          <div className="text-xs text-text-muted">
            {managed.length} de {state.status === 'ready' ? state.repos.length : '—'} repos
          </div>
        </div>
        <nav className="flex-1 overflow-y-auto p-2">
          {managed.map((repo) => {
            const isOpen = repo.managedProjectId === openProjectId;
            return (
              <button
                key={repo.githubRepoId}
                onClick={() => setOpenProjectId(repo.managedProjectId)}
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
                <div className="font-medium">{repo.name}</div>
                <div className="truncate text-xs text-text-muted">
                  {repo.owner}
                </div>
              </button>
            );
          })}
          {state.status === 'ready' && managed.length === 0 && (
            <p className="px-3 py-2 text-xs text-text-muted">
              Nenhum projeto ainda — marque repos na lista ao lado.
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

      {/* Conteúdo: workspace do projeto aberto ou catálogo de repos */}
      {openProject ? (
        <main className="min-h-0 flex-1">
          <Workspace
            key={openProject.managedProjectId}
            project={openProject}
            onBack={() => setOpenProjectId(null)}
          />
        </main>
      ) : (
      <main className="flex-1 overflow-y-auto">
        <header className="sticky top-0 border-b border-border bg-bg/80 px-8 py-5 backdrop-blur">
          <h1 className="text-lg font-semibold">Catálogo</h1>
          <p className="text-sm text-text-muted">
            Selecione os repositórios que o ProPlan deve gerenciar.
          </p>
        </header>

        <div className="p-8">
          {state.status === 'loading' && <SkeletonList />}
          {state.status === 'error' && (
            <div className="rounded-md border border-error/30 bg-error/5 p-4 text-sm text-error">
              Falha ao listar repositórios: {state.message}
            </div>
          )}
          {state.status === 'ready' && (
            <ul className="grid gap-3">
              {state.repos.map((repo, i) => (
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
                    onClick={() => void toggleManaged(repo)}
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
        </div>
      </main>
      )}
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
