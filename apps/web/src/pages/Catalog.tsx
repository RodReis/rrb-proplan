import { motion } from 'framer-motion';
import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  api,
  CatalogInstallations,
  InstallationGroup,
  Project,
  Repo,
  SessionUser,
} from '../lib/api';

interface Props {
  user: SessionUser;
  onLogout: () => void;
}

type CatalogState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; data: CatalogInstallations };

/**
 * Catálogo — porta de entrada (rota `/`), fora do shell de workspace.
 *
 * Herdado do antigo Home.tsx: aqui ele só troca de rota e re-skina via tokens
 * (SPEC-020 §8). O redesenho de página cheia (banner, grupos, `Abrir workspace`)
 * é a SPEC-021 — não antecipar.
 */
export function Catalog({ user, onLogout }: Props) {
  const navigate = useNavigate();
  const [catalog, setCatalog] = useState<CatalogState>({ status: 'loading' });
  const [, setProjects] = useState<Project[]>([]);
  const [busyRepoId, setBusyRepoId] = useState<number | null>(null);

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

  return (
    <div className="h-screen overflow-y-auto bg-bg">
      <header className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-bg/80 px-8 py-5 backdrop-blur">
        <div>
          <h1 className="text-lg font-semibold text-text">Catálogo</h1>
          <p className="text-sm text-muted">
            Repositórios onde o ProPlan (GitHub App) está instalado.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {catalog.status === 'ready' && !catalog.data.empty && (
            <button
              onClick={() => void openInstall()}
              className="rounded-[10px] border border-border2 px-3 py-1.5 text-xs font-semibold text-body2 transition-colors duration-150 hover:border-hoverb hover:text-text"
            >
              Instalar em mais repositórios
            </button>
          )}
          <button
            onClick={onLogout}
            className="rounded-[10px] px-3 py-1.5 text-xs text-muted transition-colors duration-150 hover:text-text"
          >
            Sair ({user.login})
          </button>
        </div>
      </header>

      <div className="space-y-8 p-8">
        {catalog.status === 'loading' && <SkeletonList />}
        {catalog.status === 'error' && (
          <div className="rounded-[10px] border border-error/30 bg-error/5 p-4 text-sm text-error">
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
              onOpen={(projectId) => navigate(`/p/${projectId}/overview`)}
              onInstall={() => void openInstall()}
            />
          ))}
      </div>
    </div>
  );
}

function AccountGroup({
  group,
  busyRepoId,
  onToggle,
  onOpen,
  onInstall,
}: {
  group: InstallationGroup;
  busyRepoId: number | null;
  onToggle: (repo: Repo) => void;
  onOpen: (projectId: string) => void;
  onInstall: () => void;
}) {
  return (
    <section>
      <div className="mb-3 flex items-center gap-2">
        <h2 className="text-sm font-semibold text-text">{group.account}</h2>
        <span className="rounded-full border border-border2 px-2 py-0.5 font-mono text-[8.5px] uppercase tracking-[0.1em] text-faint">
          {group.accountType === 'Organization' ? 'organização' : 'pessoal'}
        </span>
      </div>
      {group.repos.length === 0 ? (
        <div className="rounded-[14px] border border-border2 bg-surface p-4 text-sm text-muted">
          Nenhum repositório acessível nesta conta —{' '}
          <button
            onClick={onInstall}
            className="font-semibold text-accent underline-offset-2 hover:underline"
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
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{
                duration: 0.2,
                delay: Math.min(i * 0.04, 0.4),
                ease: [0.16, 1, 0.3, 1],
              }}
              className="group flex items-center justify-between rounded-[14px] border border-border2 bg-surface p-4 transition-colors duration-150 hover:border-hoverb"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm font-semibold text-text2">
                    {repo.owner}/{repo.name}
                  </span>
                  {repo.isPrivate && (
                    <span className="rounded-full border border-border2 px-2 py-0.5 font-mono text-[8.5px] uppercase tracking-[0.1em] text-faint">
                      privado
                    </span>
                  )}
                </div>
                <p className="truncate text-xs text-muted">
                  {repo.description ?? 'Sem descrição'}
                  {repo.pushedAt &&
                    ` · último push ${new Date(repo.pushedAt).toLocaleDateString('pt-BR')}`}
                </p>
              </div>
              <div className="ml-4 flex shrink-0 items-center gap-2">
                {repo.managedProjectId && (
                  <button
                    onClick={() => onOpen(repo.managedProjectId!)}
                    className="rounded-[10px] bg-btnbg px-3 py-1.5 text-xs font-semibold text-btnfg transition-[filter] duration-150 hover:brightness-110"
                  >
                    Abrir workspace
                  </button>
                )}
                <button
                  onClick={() => onToggle(repo)}
                  disabled={busyRepoId === repo.githubRepoId}
                  className={
                    repo.managedProjectId
                      ? 'rounded-[10px] border border-accent-border bg-accent-soft px-3 py-1.5 text-xs font-semibold text-accent transition-colors duration-150 disabled:opacity-50'
                      : 'rounded-[10px] border border-border2 px-3 py-1.5 text-xs font-semibold text-body2 transition-colors duration-150 hover:border-hoverb hover:text-text disabled:opacity-50'
                  }
                >
                  {busyRepoId === repo.githubRepoId
                    ? '…'
                    : repo.managedProjectId
                      ? '✓ Gerenciado'
                      : 'Gerenciar'}
                </button>
              </div>
            </motion.li>
          ))}
        </ul>
      )}
    </section>
  );
}

function EmptyInstall({ onInstall }: { onInstall: () => void }) {
  return (
    <div className="mx-auto max-w-md rounded-[16px] border border-border2 bg-surface p-8 text-center">
      <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-[10px] bg-card text-2xl">
        📦
      </div>
      <h2 className="text-base font-semibold text-text">
        O ProPlan ainda não está instalado em nenhum repositório
      </h2>
      <p className="mt-2 text-sm text-muted">
        Instale o GitHub App nos repositórios que você quer gerenciar. Você
        escolhe quais — o ProPlan só enxerga esses.
      </p>
      <button
        onClick={onInstall}
        className="mt-5 rounded-[10px] bg-btnbg px-4 py-2 text-sm font-semibold text-btnfg transition-[filter] duration-150 hover:brightness-110"
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
          className="h-[72px] animate-pulse rounded-[14px] border border-border2 bg-surface"
        />
      ))}
    </ul>
  );
}
