import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import {
  api,
  CatalogInstallations,
  InstallationGroup,
  Project,
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

/** Catálogo de quem não tem GitHub conectado (SPEC-025) — não é falha. */
const VAZIO: CatalogInstallations = { groups: [], empty: true };

/**
 * O que o Catálogo mostra abaixo do card de conexão (SPEC-025).
 *
 * Função pura porque a distinção é sutil e fácil de regredir: **desconectado
 * não é vazio**. `empty` significa "conectado, mas o App não está instalado em
 * nenhum repo" → CTA de instalar. Sem conexão o índice local vira cards
 * read-only, e oferecer "instalar" ali mandaria o usuário para o github.com
 * quando o que falta é reconectar.
 */
export function catalogView(
  connected: boolean | null,
  data: CatalogInstallations,
): 'offline' | 'install' | 'groups' | 'unknown' {
  if (connected === null) return 'unknown';
  if (!connected) return 'offline';
  return data.empty ? 'install' : 'groups';
}

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
  // `null` = ainda não sabemos (evita piscar o CTA de conectar antes da resposta).
  const [connected, setConnected] = useState<boolean | null>(null);
  // Projetos do índice local, exibidos read-only enquanto não há conexão.
  const [offline, setOffline] = useState<Project[]>([]);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);

  const load = useCallback(() => {
    setCatalog({ status: 'loading' });
    api
      .githubConnection()
      .then(({ connected }) => {
        setConnected(connected);
        // Desconectado, `/catalog/installations` é leitura no GitHub e devolveria
        // 401 — a UI leria como falha o que é um estado válido. O índice local
        // (`/catalog/projects`, só banco) é a memória que a spec manda preservar.
        if (!connected) {
          return api
            .projects()
            .then((projects) => setOffline(projects))
            .then(() => setCatalog({ status: 'ready', data: VAZIO }));
        }
        return api
          .installations()
          .then((data) => setCatalog({ status: 'ready', data }));
      })
      .catch((err) => setCatalog({ status: 'error', message: String(err) }));
  }, []);

  useEffect(() => load(), [load]);

  /** Desconectar (SPEC-025): revoga a conexão e mantém a sessão do app. */
  async function disconnect() {
    setDisconnecting(true);
    try {
      await api.disconnectGithub();
      setConfirmDisconnect(false);
      setConnected(false);
      // O índice sobrevive à desconexão — é o que vira os cards read-only.
      setOffline(await api.projects());
      setCatalog({ status: 'ready', data: VAZIO });
      toast.success('GitHub desconectado. Sua conta continua ativa.');
    } catch (err) {
      toast.error(`Não foi possível desconectar: ${String(err)}`);
    } finally {
      setDisconnecting(false);
    }
  }

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

        <button
          onClick={() => navigate('/settings')}
          title="Configurações"
          aria-label="Configurações"
          className="flex h-[34px] w-[34px] items-center justify-center rounded-[9px] border border-border2 text-muted transition-colors duration-150 hover:border-hoverb hover:text-text"
        >
          <svg
            aria-hidden
            width="15"
            height="15"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
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
              {catalog.status === 'ready' && !catalog.data.empty && connected && (
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

          {connected !== null && (
            <ConnectionCard
              connected={connected}
              login={user.login}
              onDisconnect={() => setConfirmDisconnect(true)}
            />
          )}

          {catalog.status === 'loading' && <SkeletonList />}
          {catalog.status === 'error' && (
            <div className="rounded-[14px] border border-error/30 bg-error/5 p-4 text-sm text-error">
              Falha ao listar instalações: {catalog.message}
            </div>
          )}
          {catalog.status === 'ready' &&
            catalogView(connected, catalog.data) === 'install' && (
              <EmptyInstall onInstall={() => void openInstall()} />
            )}
          {catalog.status === 'ready' &&
            catalogView(connected, catalog.data) === 'offline' && (
              <OfflineProjects projects={offline} />
            )}
          {catalog.status === 'ready' &&
            catalog.data.groups.map((group) => (
              <AccountGroup
                key={group.installationId}
                group={group}
                busyRepoId={busyRepoId}
                onManage={(r) => void manage(r)}
                onAskUnmanage={setConfirmRemove}
                // URL por slug legível (SPEC-028). Vem do que o catálogo já tem
                // em mãos — conta e nome do repo —, sem chamada extra.
                onOpen={(tenantSlug, projectSlug) =>
                  navigate(`/t/${tenantSlug}/p/${projectSlug}/overview`)
                }
                onInstall={() => void openInstall()}
              />
            ))}

          {catalog.status === 'ready' && !catalog.data.empty && (
            <p className="mt-1 text-center text-xs text-faint">
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

      {confirmDisconnect && (
        <ConfirmDialog
          title="Desconectar do GitHub?"
          message="O ProPlan deixa de acessar seus repositórios: nenhuma leitura ou escrita acontece em seu nome, e os projetos ficam somente leitura. Sua conta continua ativa — isto não é sair. Nada é apagado no GitHub, e reconectar traz tudo de volta sem reinstalar o App."
          confirmLabel={disconnecting ? 'Desconectando…' : 'Desconectar GitHub'}
          danger
          onConfirm={() => void disconnect()}
          onCancel={() => setConfirmDisconnect(false)}
        />
      )}
    </div>
  );
}

/**
 * Card de conexão (SPEC-025) — o estado do GitHub, acima da lista.
 *
 * Distingue as três ações que a spec diz serem confundíveis: desconectar mora
 * aqui (revoga a autorização), desgerenciar fica em cada repo (índice local) e
 * desinstalar o App é link externo para o github.com. Sem conexão, o card vira
 * o CTA de conectar — é a única porta para o catálogo voltar a viver.
 */
function ConnectionCard({
  connected,
  login,
  onDisconnect,
}: {
  connected: boolean;
  login: string;
  onDisconnect: () => void;
}) {
  return (
    <section
      className={
        'flex items-center gap-4 rounded-[14px] border px-5 py-4 ' +
        (connected ? 'border-border bg-panel' : 'border-accent-border bg-pop/30')
      }
    >
      <span
        aria-hidden
        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-border2 bg-card text-body2"
      >
        <GithubMark />
      </span>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="font-mono text-[9px] uppercase tracking-[0.14em] text-faint">
            Conexão
          </span>
          <span
            className={
              'flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-medium ' +
              (connected ? 'bg-success/10 text-success' : 'bg-card text-muted')
            }
          >
            <span
              aria-hidden
              className={
                'h-1.5 w-1.5 rounded-full ' +
                (connected ? 'bg-success' : 'bg-muted')
              }
            />
            {connected ? 'Ativo' : 'Desconectado'}
          </span>
        </div>
        <h2 className="mt-0.5 text-[15px] font-semibold">
          {connected ? 'GitHub conectado' : 'GitHub desconectado'}
        </h2>
        <p className="mt-0.5 truncate font-mono text-[11px] text-muted">
          {connected
            ? `@${login} · GitHub App instalado · leitura de documentação`
            : 'Seus projetos estão somente leitura. Reconecte para voltar a sincronizar.'}
        </p>
      </div>

      {connected ? (
        <button
          onClick={onDisconnect}
          className="h-9 shrink-0 rounded-[9px] border border-error/40 px-4 text-[12.5px] font-medium text-error transition-colors duration-150 hover:border-error hover:bg-error/10"
        >
          Desconectar
        </button>
      ) : (
        <a
          href={api.loginUrl}
          className="flex h-9 shrink-0 items-center gap-2 rounded-[9px] border px-4 text-[12.5px] font-medium transition-[filter] duration-150 hover:brightness-110"
          style={{
            borderColor: 'var(--accentBorder)',
            background: 'color-mix(in srgb, var(--pop) 60%, transparent)',
          }}
        >
          <GithubMark size={13} />
          Conectar GitHub
        </a>
      )}
    </section>
  );
}

/**
 * Projetos do índice local enquanto o GitHub está desconectado (SPEC-025 §4).
 *
 * São **read-only de verdade**: sem `Abrir workspace`, sem desgerenciar. As
 * abas leem do GitHub, e abrir um workspace sem conexão daria erro no lugar de
 * conteúdo. O selo diz por que o card está inerte; o CTA de reconectar vive no
 * card de conexão acima, que é o único caminho de volta.
 */
function OfflineProjects({ projects }: { projects: Project[] }) {
  if (projects.length === 0) {
    return (
      <div className="rounded-[14px] border border-border2 bg-surface p-5 text-center text-sm text-muted">
        Nenhum projeto no índice local. Conecte o GitHub para escolher
        repositórios.
      </div>
    );
  }

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center gap-2.5">
        <span className="text-[15px] font-semibold">Projetos</span>
        <span className="flex-1" />
        <span className="text-xs text-faint">
          {projects.length} no índice · somente leitura
        </span>
      </div>
      <ul className="flex flex-col gap-2.5">
        {projects.map((p) => (
          <li
            key={p.id}
            className="flex items-center gap-4 rounded-[14px] border border-border2 bg-surface px-[18px] py-[15px] opacity-70"
          >
            <span
              aria-hidden
              className="h-2 w-2 shrink-0 rounded-full"
              style={{ background: 'var(--dimmer)' }}
            />
            <span className="flex min-w-0 flex-1 flex-col gap-[3px]">
              <span className="flex min-w-0 items-center gap-2">
                <span className="whitespace-nowrap text-[13.5px] text-muted">
                  {p.owner}/
                </span>
                <span className="-ml-2 truncate text-[13.5px] font-semibold text-text">
                  {p.name}
                </span>
              </span>
              <span className="truncate text-xs text-faint">
                {p.description ?? 'Sem descrição'}
              </span>
            </span>
            <span className="shrink-0 rounded-full border border-border2 px-[9px] py-[3px] font-mono text-[8.5px] uppercase tracking-[0.08em] text-faint">
              GitHub desconectado
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function GithubMark({ size = 20 }: { size?: number }) {
  return (
    <svg aria-hidden width={size} height={size} viewBox="0 0 16 16" fill="currentColor">
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0016 8c0-4.42-3.58-8-8-8z" />
    </svg>
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
  onOpen: (tenantSlug: string, projectSlug: string) => void;
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
        <span className="text-xs text-faint">
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
              onOpen={() => {
                if (!repo.managedProjectId) return;
                // tenantId null = instalação ainda não reconciliada a um tenant
                // (PR-5). Sinaliza em vez de engolir o clique em silêncio.
                if (!group.tenantId) {
                  toast.error(
                    'Este repositório ainda não foi vinculado a um tenant. Sincronize o catálogo e tente de novo.',
                  );
                  return;
                }
                // Slugs canônicos (lowercase), a mesma forma que o /resolve
                // devolve — assim a URL já nasce canônica e não é reescrita.
                onOpen(group.account.toLowerCase(), repo.name.toLowerCase());
              }}
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
            <span className="shrink-0 rounded-full border border-border2 px-[7px] py-[2px] font-mono text-[8.5px] uppercase tracking-[0.08em] text-faint">
              privado
            </span>
          )}
        </span>
        <span className="truncate text-xs text-faint">
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
