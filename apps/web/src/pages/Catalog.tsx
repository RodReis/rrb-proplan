import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  api,
  CatalogInstallations,
  InstallationGroup,
  Repo,
  SessionUser,
} from '../lib/api';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { useTheme } from '../theme';
import bannerCarbono from '../assets/catalogo-banner.png';
import bannerClaro from '../assets/catalogo-banner-claro.jpg';

interface Props {
  user: SessionUser;
  onLogout: () => void;
}

type CatalogState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; data: CatalogInstallations };

/**
 * Catálogo (SPEC-021 §2) — página cheia em `/`, fora do shell de workspace.
 *
 * É a porta de entrada: header próprio, banner, grupos por instalação. Cada
 * repo gerenciado oferece `Abrir workspace`; desgerenciar pede confirmação.
 */
export function Catalog({ user, onLogout }: Props) {
  const navigate = useNavigate();
  const { theme, toggle } = useTheme();
  const [catalog, setCatalog] = useState<CatalogState>({ status: 'loading' });
  const [busyRepoId, setBusyRepoId] = useState<number | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<Repo | null>(null);

  const load = useCallback(() => {
    setCatalog({ status: 'loading' });
    api
      .installations()
      .then((data) => setCatalog({ status: 'ready', data }))
      .catch((err) => setCatalog({ status: 'error', message: String(err) }));
  }, []);

  useEffect(() => load(), [load]);

  async function manage(repo: Repo) {
    setBusyRepoId(repo.githubRepoId);
    try {
      await api.addProject(repo);
      setCatalog({ status: 'ready', data: await api.installations() });
    } finally {
      setBusyRepoId(null);
    }
  }

  /** Desgerenciar: remove só o índice local — o repositório não é tocado. */
  async function unmanage(repo: Repo) {
    if (!repo.managedProjectId) return;
    setBusyRepoId(repo.githubRepoId);
    setConfirmRemove(null);
    try {
      await api.removeProject(repo.managedProjectId);
      setCatalog({ status: 'ready', data: await api.installations() });
    } finally {
      setBusyRepoId(null);
    }
  }

  async function openInstall() {
    const { url } = await api.installUrl();
    window.location.href = url;
  }

  const dark = theme === 'carbono';
  const banner = dark ? bannerCarbono : bannerClaro;
  // Gradiente de leitura lateral (§10): o texto vive à esquerda do banner.
  const bannerOverlay = dark
    ? 'linear-gradient(90deg, rgba(12,13,15,.9), rgba(12,13,15,.5) 55%, rgba(12,13,15,.15))'
    : 'linear-gradient(90deg, rgba(250,250,248,.92), rgba(250,250,248,.55) 55%, rgba(250,250,248,.15))';

  const totals =
    catalog.status === 'ready'
      ? countRepos(catalog.data)
      : { repos: 0, managed: 0 };

  return (
    <div className="flex min-h-screen flex-col bg-bg text-text">
      <header className="flex h-[60px] shrink-0 items-center gap-3.5 border-b border-border bg-panel px-7">
        <div className="flex items-center gap-2.5">
          <span
            aria-hidden
            className="flex h-8 w-8 items-center justify-center rounded-[9px] text-[15px] font-bold"
            style={{ background: 'var(--brand-gradient)', color: 'var(--brand-fg)' }}
          >
            P
          </span>
          <span className="flex flex-col">
            <span className="text-sm font-semibold">ProPlan</span>
            <span className="font-mono text-[9px] uppercase tracking-[0.14em] text-faint">
              Catálogo
            </span>
          </span>
        </div>

        <div className="flex-1" />

        <button
          onClick={toggle}
          title={dark ? 'Mudar para o tema Claro' : 'Mudar para o tema Carbono'}
          aria-label={dark ? 'Mudar para o tema Claro' : 'Mudar para o tema Carbono'}
          className="flex h-[34px] w-[34px] items-center justify-center rounded-[9px] border border-border2 text-muted transition-colors duration-150 hover:border-hoverb hover:text-text"
        >
          <ThemeIcon dark={dark} />
        </button>

        <div className="flex items-center gap-2.5 border-l border-border pl-3.5">
          {user.avatarUrl ? (
            <img
              src={user.avatarUrl}
              alt=""
              className="h-[30px] w-[30px] rounded-full border border-border2"
            />
          ) : (
            <span className="flex h-[30px] w-[30px] items-center justify-center rounded-full bg-card text-xs font-semibold text-body2">
              {(user.name ?? user.login).charAt(0).toUpperCase()}
            </span>
          )}
          <span className="text-[13px] font-medium">{user.name ?? user.login}</span>
          <button
            onClick={onLogout}
            className="text-xs text-muted transition-colors duration-150 hover:text-text"
          >
            Sair
          </button>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto flex max-w-[920px] flex-col gap-[22px] px-8 pb-16 pt-9">
          <section className="relative flex min-h-[160px] items-end overflow-hidden rounded-[18px] border border-border">
            <div
              aria-hidden
              className="anim-heroZoom absolute inset-0 bg-cover"
              style={{ backgroundImage: `url(${banner})`, backgroundPosition: 'center 42%' }}
            />
            <div aria-hidden className="absolute inset-0" style={{ background: bannerOverlay }} />
            <div className="relative flex flex-1 items-end justify-between gap-4 px-6 pb-[22px] pt-7">
              <div>
                <h1 className="m-0 text-2xl font-semibold tracking-[-0.01em]">Catálogo</h1>
                <p className="mt-[7px] max-w-[460px] text-[13.5px] text-body">
                  Repositórios onde o ProPlan (GitHub App) está instalado. Escolha quais
                  serão gerenciados.
                </p>
              </div>
              {catalog.status === 'ready' && !catalog.data.empty && (
                <button
                  onClick={() => void openInstall()}
                  className="flex h-9 shrink-0 items-center gap-2 whitespace-nowrap rounded-[9px] border px-4 text-[12.5px] font-medium backdrop-blur-md transition-[filter] duration-150 hover:brightness-110"
                  style={{
                    borderColor: 'var(--accentBorder)',
                    background: 'color-mix(in srgb, var(--pop) 60%, transparent)',
                  }}
                >
                  <svg
                    aria-hidden
                    width="13"
                    height="13"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M12 5v14M5 12h14" />
                  </svg>
                  Instalar em mais repositórios
                </button>
              )}
            </div>
          </section>

          {catalog.status === 'loading' && <SkeletonList />}
          {catalog.status === 'error' && (
            <div className="rounded-[14px] border border-error/30 bg-error/5 p-4 text-sm text-error">
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
                onManage={(r) => void manage(r)}
                onAskUnmanage={setConfirmRemove}
                onOpen={(id) => navigate(`/p/${id}/overview`)}
                onInstall={() => void openInstall()}
              />
            ))}

          {catalog.status === 'ready' && !catalog.data.empty && (
            <p className="mt-1 text-center text-xs text-dim">
              {totals.repos} repositórios · {totals.managed} gerenciados · Somente leitura
              de documentação — o ProPlan nunca clona seu código. Gerenciar um repositório
              cria o workspace dele.
            </p>
          )}
        </div>
      </div>

      {confirmRemove && (
        <ConfirmDialog
          title="Deixar de gerenciar este repositório?"
          message={`O ProPlan remove ${confirmRemove.owner}/${confirmRemove.name} do índice local — documentos, board e inferências deixam de ser exibidos. O repositório no GitHub não é tocado: nada é apagado, movido ou reescrito. Você pode voltar a gerenciá-lo quando quiser.`}
          confirmLabel="Deixar de gerenciar"
          onConfirm={() => void unmanage(confirmRemove)}
          onCancel={() => setConfirmRemove(null)}
        />
      )}
    </div>
  );
}

function AccountGroup({
  group,
  busyRepoId,
  onManage,
  onAskUnmanage,
  onOpen,
  onInstall,
}: {
  group: InstallationGroup;
  busyRepoId: number | null;
  onManage: (repo: Repo) => void;
  onAskUnmanage: (repo: Repo) => void;
  onOpen: (projectId: string) => void;
  onInstall: () => void;
}) {
  const managed = group.repos.filter((r) => r.managedProjectId).length;

  return (
    <section>
      <div className="mb-2.5 mt-1.5 flex items-center gap-2.5">
        <span className="text-[15px] font-semibold">{group.account}</span>
        <span className="rounded-full border border-border2 px-2 py-[3px] font-mono text-[8.5px] uppercase tracking-[0.1em] text-faint">
          {group.accountType === 'Organization' ? 'organização' : 'pessoal'}
        </span>
        <span className="flex-1" />
        <span className="text-xs text-dim">
          {group.repos.length} repositórios · {managed} gerenciados
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
        <ul className="flex flex-col gap-2.5">
          {group.repos.map((repo) => (
            <RepoRow
              key={repo.githubRepoId}
              repo={repo}
              busy={busyRepoId === repo.githubRepoId}
              onManage={() => onManage(repo)}
              onAskUnmanage={() => onAskUnmanage(repo)}
              onOpen={() => repo.managedProjectId && onOpen(repo.managedProjectId)}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

/** Linha densa de repositório (fonte: protótipo; decisão do PI em 2026-07-16). */
function RepoRow({
  repo,
  busy,
  onManage,
  onAskUnmanage,
  onOpen,
}: {
  repo: Repo;
  busy: boolean;
  onManage: () => void;
  onAskUnmanage: () => void;
  onOpen: () => void;
}) {
  const managed = repo.managedProjectId !== null;

  return (
    <li
      className="flex items-center gap-4 rounded-[14px] border bg-surface px-[18px] py-[15px] transition-colors duration-150 hover:border-hoverb"
      style={{ borderColor: managed ? 'var(--accentBorder)' : 'var(--border2)' }}
    >
      <span
        aria-hidden
        className="h-2 w-2 shrink-0 rounded-full"
        style={{ background: managed ? 'var(--success)' : 'var(--dimmer)' }}
      />

      <span className="flex min-w-0 flex-1 flex-col gap-[3px]">
        <span className="flex min-w-0 items-center gap-2">
          <span className="whitespace-nowrap text-[13.5px] text-muted">{repo.owner}/</span>
          <span className="-ml-2 truncate text-[13.5px] font-semibold text-text">
            {repo.name}
          </span>
          {repo.isPrivate && (
            <span className="shrink-0 rounded-full border border-border2 px-[7px] py-[2px] font-mono text-[8.5px] uppercase tracking-[0.08em] text-dim">
              privado
            </span>
          )}
        </span>
        <span className="truncate text-xs text-dim">
          {repo.description ?? 'Sem descrição'}
          {repo.pushedAt &&
            ` · último push ${new Date(repo.pushedAt).toLocaleDateString('pt-BR')}`}
        </span>
      </span>

      {managed && (
        <button
          onClick={onOpen}
          className="flex shrink-0 items-center gap-1.5 whitespace-nowrap text-xs text-muted transition-colors duration-150 hover:text-text"
        >
          Abrir workspace
          <svg
            aria-hidden
            width="11"
            height="11"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M5 12h14M12 5l7 7-7 7" />
          </svg>
        </button>
      )}

      <button
        onClick={managed ? onAskUnmanage : onManage}
        disabled={busy}
        title={managed ? 'Deixar de gerenciar (pede confirmação)' : undefined}
        className="flex h-8 w-[122px] shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-[9px] border text-xs font-semibold transition-colors duration-150 disabled:opacity-60"
        style={
          managed
            ? {
                borderColor: 'var(--accentBorder)',
                background: 'var(--accentSoft)',
                color: 'var(--text)',
              }
            : { borderColor: 'var(--border2)', color: 'var(--body2)' }
        }
      >
        {busy ? (
          <span
            aria-label="Salvando"
            className="h-3.5 w-3.5 rounded-full border-2 border-current border-t-transparent"
            style={{ animation: 'spin .7s linear infinite' }}
          />
        ) : managed ? (
          <>
            <svg
              aria-hidden
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.4"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M20 6 9 17l-5-5" />
            </svg>
            Gerenciado
          </>
        ) : (
          'Gerenciar'
        )}
      </button>
    </li>
  );
}

function EmptyInstall({ onInstall }: { onInstall: () => void }) {
  return (
    <div className="mx-auto max-w-md rounded-[16px] border border-border2 bg-surface p-8 text-center">
      <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-[10px] bg-card text-2xl">
        📦
      </div>
      <h2 className="text-base font-semibold">
        O ProPlan ainda não está instalado em nenhum repositório
      </h2>
      <p className="mt-2 text-sm text-muted">
        Instale o GitHub App nos repositórios que você quer gerenciar. Você escolhe quais —
        o ProPlan só enxerga esses.
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
    <ul className="flex flex-col gap-2.5">
      {Array.from({ length: 6 }).map((_, i) => (
        <li
          key={i}
          className="h-[62px] animate-pulse rounded-[14px] border border-border2 bg-surface"
        />
      ))}
    </ul>
  );
}

function countRepos(data: CatalogInstallations): { repos: number; managed: number } {
  const repos = data.groups.flatMap((g) => g.repos);
  return {
    repos: repos.length,
    managed: repos.filter((r) => r.managedProjectId).length,
  };
}

function ThemeIcon({ dark }: { dark: boolean }) {
  return (
    <svg
      aria-hidden
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {dark ? (
        <>
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
        </>
      ) : (
        <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8" />
      )}
    </svg>
  );
}
