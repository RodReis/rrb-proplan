import { useCallback, useEffect, useMemo, useState } from 'react';
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
import { AppShell } from '../components/AppShell';
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

type CatalogFilter = 'all' | 'managed' | 'unmanaged' | 'private';
type CatalogSort = 'status' | 'updated' | 'name';

type CatalogRepoRow = {
  repo: Repo;
  account: string;
  accountType: InstallationGroup['accountType'];
  tenantId: InstallationGroup['tenantId'];
};

const DEFAULT_PAGE_SIZE = 8;

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

export function catalogPageSizeForViewport(width: number, height: number): number {
  if (width <= 720) return 5;
  if (height >= 980) return 11;
  if (height >= 860) return 9;
  if (height >= 760) return 8;
  return 6;
}

function useCatalogPageSize(): number {
  const [pageSize, setPageSize] = useState(() =>
    typeof window === 'undefined'
      ? DEFAULT_PAGE_SIZE
      : catalogPageSizeForViewport(window.innerWidth, window.innerHeight),
  );

  useEffect(() => {
    function updatePageSize() {
      setPageSize(catalogPageSizeForViewport(window.innerWidth, window.innerHeight));
    }

    updatePageSize();
    window.addEventListener('resize', updatePageSize);
    return () => window.removeEventListener('resize', updatePageSize);
  }, []);

  return pageSize;
}

/**
 * Catálogo (SPEC-021 §2) — página cheia em `/`, fora do shell de workspace.
 *
 * É a porta de entrada: header próprio, banner, grupos por instalação. Cada
 * repo gerenciado oferece `Abrir workspace`; desgerenciar pede confirmação.
 */
export function Catalog({ user, onLogout }: Props) {
  const navigate = useNavigate();
  const { theme } = useTheme();
  const [catalog, setCatalog] = useState<CatalogState>({ status: 'loading' });
  const [busyRepoId, setBusyRepoId] = useState<number | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<Repo | null>(null);
  // `null` = ainda não sabemos (evita piscar o CTA de conectar antes da resposta).
  const [connected, setConnected] = useState<boolean | null>(null);
  // Projetos do índice local, exibidos read-only enquanto não há conexão.
  const [offline, setOffline] = useState<Project[]>([]);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<CatalogFilter>('all');
  const [sort, setSort] = useState<CatalogSort>('status');
  const [page, setPage] = useState(0);
  const pageSize = useCatalogPageSize();

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
  const rows = useMemo(
    () => (catalog.status === 'ready' ? catalogRows(catalog.data) : []),
    [catalog],
  );
  const filteredRows = useMemo(
    () => filterCatalogRows(rows, query, filter, sort),
    [rows, query, filter, sort],
  );
  const pageCount = Math.max(1, Math.ceil(filteredRows.length / pageSize));
  const pageRows = filteredRows.slice(page * pageSize, page * pageSize + pageSize);
  const view = catalog.status === 'ready' ? catalogView(connected, catalog.data) : null;

  useEffect(() => setPage(0), [query, filter, sort, rows.length]);
  useEffect(() => setPage((current) => Math.min(current, pageCount - 1)), [pageCount]);

  function openRepoWorkspace(row: CatalogRepoRow) {
    if (!row.repo.managedProjectId) return;
    if (!row.tenantId) {
      toast.error(
        'Este repositório ainda não foi vinculado a um tenant. Sincronize o catálogo e tente de novo.',
      );
      return;
    }
    navigate(`/t/${row.account.toLowerCase()}/p/${row.repo.name.toLowerCase()}/overview`);
  }

  return (
    <AppShell user={user} tenant={user.tenants[0]?.accountLogin ?? null} section="ProPlan" onLogout={onLogout}>
      <div className="min-h-0 flex-1 overflow-hidden max-[1100px]:overflow-y-auto">
        <div className="mx-auto grid h-full w-full max-w-[1480px] grid-rows-[auto_minmax(0,1fr)] gap-4 px-6 py-5 max-[1100px]:h-auto max-[1100px]:min-h-full max-[720px]:px-3 max-[720px]:py-3">
          <section className="relative flex min-h-[94px] items-center overflow-hidden rounded-[14px] border border-border">
            <div
              aria-hidden
              className="anim-heroZoom absolute inset-0 bg-cover"
              style={{ backgroundImage: `url(${banner})`, backgroundPosition: 'center 42%' }}
            />
            <div aria-hidden className="absolute inset-0" style={{ background: bannerOverlay }} />
            <div className="relative flex flex-1 items-center justify-between gap-4 px-5 py-4 max-[720px]:flex-col max-[720px]:items-start">
              <div className="min-w-0">
                <h1 className="m-0 text-2xl font-semibold tracking-[-0.01em]">Repositórios GitHub</h1>
                <p className="mt-1 max-w-[620px] text-[13.5px] text-body">
                  Repositórios onde o ProPlan (GitHub App) está instalado. Escolha quais
                  serão gerenciados.
                </p>
              </div>
              {catalog.status === 'ready' && !catalog.data.empty && connected && (
                <button
                  onClick={() => void openInstall()}
                  className="flex h-9 shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-[9px] border px-4 text-[12.5px] font-medium backdrop-blur-md transition-[filter] duration-150 hover:brightness-110 max-[720px]:w-full max-[720px]:whitespace-normal"
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

          <div className="grid min-h-0 grid-cols-[minmax(0,1fr)_320px] gap-4 max-[1100px]:grid-cols-1">
            <section className="flex min-h-0 flex-col self-start overflow-hidden rounded-[14px] border border-border bg-panel">
              {view === 'groups' && (
                <CatalogToolbar
                  query={query}
                  filter={filter}
                  sort={sort}
                  rows={rows}
                  filteredCount={filteredRows.length}
                  onQuery={setQuery}
                  onFilter={setFilter}
                  onSort={setSort}
                />
              )}

              {catalog.status === 'loading' && <SkeletonList pageSize={pageSize} />}
              {catalog.status === 'error' && (
                <div className="m-4 rounded-[12px] border border-error/30 bg-error/5 p-4 text-sm text-error">
                  Falha ao listar instalações: {catalog.message}
                </div>
              )}
              {catalog.status === 'ready' && view === 'install' && (
                <EmptyInstall onInstall={() => void openInstall()} />
              )}
              {catalog.status === 'ready' && view === 'offline' && (
                <OfflineProjects projects={offline} pageSize={pageSize} />
              )}
              {catalog.status === 'ready' && view === 'groups' && (
                <CatalogTable
                  rows={pageRows}
                  busyRepoId={busyRepoId}
                  onManage={(r) => void manage(r)}
                  onAskUnmanage={setConfirmRemove}
                  onOpen={openRepoWorkspace}
                />
              )}

              {catalog.status === 'ready' && view === 'groups' && (
                <CatalogPagination
                  page={page}
                  pageCount={pageCount}
                  total={filteredRows.length}
                  onPrev={() => setPage((p) => Math.max(0, p - 1))}
                  onNext={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
                />
              )}
            </section>

            <aside className="flex min-h-0 flex-col gap-3 max-[1100px]:hidden">
              {connected !== null && (
                <ConnectionCard
                  connected={connected}
                  login={user.login}
                  onDisconnect={() => setConfirmDisconnect(true)}
                />
              )}
              <CatalogSummary
                totals={totals}
                groups={catalog.status === 'ready' ? catalog.data.groups.length : 0}
                connected={connected}
                onInstall={() => void openInstall()}
              />
            </aside>
          </div>
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
    </AppShell>
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
        {connected ? (
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            <span className="font-mono text-[10.5px] text-muted">@{login}</span>
            <span className="rounded-full border border-border2 px-1.5 py-0.5 font-mono text-[8.5px] uppercase tracking-[0.08em] text-faint">
              App instalado
            </span>
            <span className="rounded-full border border-border2 px-1.5 py-0.5 font-mono text-[8.5px] uppercase tracking-[0.08em] text-faint">
              docs
            </span>
          </div>
        ) : (
          <p className="mt-0.5 text-[12px] leading-snug text-muted">
            Seus projetos estão somente leitura. Reconecte para voltar a sincronizar.
          </p>
        )}
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
function OfflineProjects({ projects, pageSize }: { projects: Project[]; pageSize: number }) {
  if (projects.length === 0) {
    return (
      <div className="m-4 rounded-[12px] border border-border2 bg-surface p-5 text-center text-sm text-muted">
        Nenhum projeto no índice local. Conecte o GitHub para escolher
        repositórios.
      </div>
    );
  }

  return (
    <section className="min-h-0 flex-1 overflow-hidden">
      <div className="flex h-10 items-center gap-2.5 border-b border-border px-4">
        <span className="text-[15px] font-semibold">Projetos</span>
        <span className="flex-1" />
        <span className="text-xs text-faint">
          {projects.length} no índice · somente leitura
        </span>
      </div>
      <ul className="grid">
        {projects.slice(0, pageSize).map((p) => (
          <li
            key={p.id}
            className="flex min-h-[58px] items-center gap-4 border-b border-border/70 px-4 opacity-70"
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

function CatalogToolbar({
  query,
  filter,
  sort,
  rows,
  filteredCount,
  onQuery,
  onFilter,
  onSort,
}: {
  query: string;
  filter: CatalogFilter;
  sort: CatalogSort;
  rows: CatalogRepoRow[];
  filteredCount: number;
  onQuery: (value: string) => void;
  onFilter: (value: CatalogFilter) => void;
  onSort: (value: CatalogSort) => void;
}) {
  const counts = countCatalogRows(rows);
  const filters: Array<{ id: CatalogFilter; label: string; count: number }> = [
    { id: 'all', label: 'Todos', count: rows.length },
    { id: 'managed', label: 'Gerenciados', count: counts.managed },
    { id: 'unmanaged', label: 'Pendentes', count: counts.unmanaged },
    { id: 'private', label: 'Privados', count: counts.private },
  ];

  return (
    <div className="flex shrink-0 flex-wrap items-center gap-3 border-b border-border px-4 py-3">
      <label className="flex h-9 min-w-[260px] flex-1 items-center gap-2 rounded-[9px] border border-border2 bg-surface px-3 text-[13px] text-muted transition-colors focus-within:border-hoverb">
        <SearchIcon />
        <input
          value={query}
          onChange={(event) => onQuery(event.target.value)}
          placeholder="Buscar repositório, conta ou descrição"
          className="min-w-0 flex-1 bg-transparent text-text outline-none placeholder:text-muted"
        />
      </label>

      <div className="flex items-center gap-1 rounded-[10px] border border-border2 bg-surface p-1">
        {filters.map((item) => (
          <button
            key={item.id}
            onClick={() => onFilter(item.id)}
            className={
              'h-7 rounded-[7px] px-2.5 text-[11.5px] font-medium transition-colors ' +
              (filter === item.id
                ? 'bg-card text-text'
                : 'text-muted hover:bg-card/70 hover:text-text')
            }
          >
            {item.label} <span className="text-faint">{item.count}</span>
          </button>
        ))}
      </div>

      <label className="flex h-9 items-center gap-2 rounded-[9px] border border-border2 bg-surface px-3 text-[12px] text-muted">
        Ordenar
        <select
          value={sort}
          onChange={(event) => onSort(event.target.value as CatalogSort)}
          className="bg-transparent text-text outline-none"
        >
          <option value="status">estado</option>
          <option value="updated">ultimo push</option>
          <option value="name">nome</option>
        </select>
      </label>

      <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-faint">
        {filteredCount} visíveis
      </span>
    </div>
  );
}

function CatalogTable({
  rows,
  busyRepoId,
  onManage,
  onAskUnmanage,
  onOpen,
}: {
  rows: CatalogRepoRow[];
  busyRepoId: number | null;
  onManage: (repo: Repo) => void;
  onAskUnmanage: (repo: Repo) => void;
  onOpen: (row: CatalogRepoRow) => void;
}) {
  if (rows.length === 0) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center p-6 text-center">
        <div className="max-w-sm">
          <h2 className="text-sm font-semibold">Nenhum repositório neste recorte</h2>
          <p className="mt-1 text-sm text-muted">
            Ajuste a busca ou troque o filtro para voltar a ver o catálogo.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-0 overflow-x-auto overflow-y-hidden">
      <div className="min-w-[890px] max-[720px]:min-w-0">
        <div className="grid h-9 grid-cols-[minmax(260px,1.35fr)_minmax(180px,.7fr)_120px_120px_210px] items-center gap-3 border-b border-border px-4 font-mono text-[9px] uppercase tracking-[0.12em] text-faint max-[720px]:hidden">
          <span>Repositório</span>
          <span>Conta</span>
          <span>Estado</span>
          <span>Último push</span>
          <span className="text-right">Ações</span>
        </div>
        <ul className="grid max-[720px]:grid-rows-none">
          {rows.map((row) => (
            <DenseRepoRow
              key={row.repo.githubRepoId}
              row={row}
              busy={busyRepoId === row.repo.githubRepoId}
              onManage={() => onManage(row.repo)}
              onAskUnmanage={() => onAskUnmanage(row.repo)}
              onOpen={() => onOpen(row)}
            />
          ))}
        </ul>
      </div>
    </div>
  );
}

function DenseRepoRow({
  row,
  busy,
  onManage,
  onAskUnmanage,
  onOpen,
}: {
  row: CatalogRepoRow;
  busy: boolean;
  onManage: () => void;
  onAskUnmanage: () => void;
  onOpen: () => void;
}) {
  const { repo } = row;
  const managed = repo.managedProjectId !== null;

  return (
    <li className="grid min-h-[58px] grid-cols-[minmax(260px,1.35fr)_minmax(180px,.7fr)_120px_120px_210px] items-center gap-3 border-b border-border/70 px-4 transition-colors duration-150 hover:bg-card/45 max-[720px]:min-h-[86px] max-[720px]:grid-cols-[minmax(0,1fr)_116px] max-[720px]:items-center max-[720px]:gap-x-3 max-[720px]:gap-y-1 max-[720px]:py-3">
      <span className="flex min-w-0 items-center gap-3">
        <span
          aria-hidden
          className="h-2 w-2 shrink-0 rounded-full"
          style={{ background: managed ? 'var(--success)' : 'var(--dimmer)' }}
        />
        <span className="min-w-0">
          <span className="flex min-w-0 items-center gap-2">
            <span className="truncate text-[13px] font-semibold text-text">
              {repo.owner}/{repo.name}
            </span>
            {repo.isPrivate && (
              <span className="shrink-0 rounded-full border border-border2 px-[7px] py-[2px] font-mono text-[8.5px] uppercase tracking-[0.08em] text-faint">
                privado
              </span>
            )}
          </span>
          <span className="block truncate text-[11.5px] text-faint">
            {repo.description ?? 'Sem descrição'}
          </span>
        </span>
      </span>

      <span className="min-w-0 max-[720px]:hidden">
        <span className="block truncate text-[12px] text-body">{row.account}</span>
        <span className="block truncate font-mono text-[9px] uppercase tracking-[0.08em] text-faint">
          {row.accountType === 'Organization' ? 'organização' : 'pessoal'}
        </span>
      </span>

      <span
        className={
          'inline-flex w-fit items-center gap-1.5 rounded-full px-2 py-1 text-[11px] font-medium max-[720px]:col-start-1 max-[720px]:row-start-2 ' +
          (managed ? 'bg-success/10 text-success' : 'bg-card text-muted')
        }
      >
        <span
          aria-hidden
          className={'h-1.5 w-1.5 rounded-full ' + (managed ? 'bg-success' : 'bg-muted')}
        />
        {managed ? 'Gerenciado' : 'Pendente'}
      </span>

      <span className="truncate text-[12px] text-muted max-[720px]:hidden">
        {repo.pushedAt ? new Date(repo.pushedAt).toLocaleDateString('pt-BR') : 'sem data'}
      </span>

      <span className="flex items-center justify-end gap-2 max-[720px]:row-span-2 max-[720px]:flex-col max-[720px]:items-stretch max-[720px]:gap-1">
        {managed && (
          <button
            onClick={onOpen}
            className="flex h-8 shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-[9px] border border-border2 px-3 text-xs font-medium text-body transition-colors duration-150 hover:border-hoverb hover:text-text"
          >
            Abrir
            <ArrowRightIcon />
          </button>
        )}
        <button
          onClick={managed ? onAskUnmanage : onManage}
          disabled={busy}
          title={managed ? 'Deixar de gerenciar (pede confirmação)' : undefined}
          className="flex h-8 w-[116px] shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-[9px] border text-xs font-semibold transition-colors duration-150 disabled:opacity-60"
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
              <CheckIcon />
              Desgerenciar
            </>
          ) : (
            'Gerenciar'
          )}
        </button>
      </span>
    </li>
  );
}

function CatalogPagination({
  page,
  pageCount,
  total,
  onPrev,
  onNext,
}: {
  page: number;
  pageCount: number;
  total: number;
  onPrev: () => void;
  onNext: () => void;
}) {
  return (
    <div className="flex h-12 shrink-0 items-center justify-between border-t border-border px-4">
      <span className="text-xs text-faint">
        {total === 0 ? 'Nenhum repo' : `${total} repo${total === 1 ? '' : 's'} no recorte`}
      </span>
      <div className="flex items-center gap-2">
        <button
          onClick={onPrev}
          disabled={page === 0}
          className="h-8 rounded-[9px] border border-border2 px-3 text-xs text-body transition-colors duration-150 hover:border-hoverb hover:text-text disabled:opacity-40"
        >
          Anterior
        </button>
        <span className="min-w-[58px] text-center font-mono text-[10px] uppercase tracking-[0.1em] text-faint">
          {page + 1}/{pageCount}
        </span>
        <button
          onClick={onNext}
          disabled={page >= pageCount - 1}
          className="h-8 rounded-[9px] border border-border2 px-3 text-xs text-body transition-colors duration-150 hover:border-hoverb hover:text-text disabled:opacity-40"
        >
          Próxima
        </button>
      </div>
    </div>
  );
}

function CatalogSummary({
  totals,
  groups,
  connected,
  onInstall,
}: {
  totals: { repos: number; managed: number };
  groups: number;
  connected: boolean | null;
  onInstall: () => void;
}) {
  const pending = Math.max(0, totals.repos - totals.managed);

  return (
    <section className="rounded-[14px] border border-border bg-panel p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-[15px] font-semibold">Resumo</h2>
        <span className="font-mono text-[9px] uppercase tracking-[0.12em] text-faint">
          catálogo
        </span>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-2">
        <SummaryStat label="Repos" value={totals.repos} />
        <SummaryStat label="Gerenciados" value={totals.managed} />
        <SummaryStat label="Pendentes" value={pending} />
        <SummaryStat label="Contas" value={groups} />
      </div>
      <p className="mt-4 text-xs leading-relaxed text-muted">
        Somente leitura de documentação. Gerenciar um repositório cria o workspace
        local; o ProPlan nunca clona seu código.
      </p>
      {connected && (
        <button
          onClick={onInstall}
          className="mt-4 flex h-9 w-full items-center justify-center gap-2 rounded-[9px] border px-3 text-[12.5px] font-medium transition-[filter] duration-150 hover:brightness-110"
          style={{
            borderColor: 'var(--accentBorder)',
            background: 'color-mix(in srgb, var(--pop) 60%, transparent)',
          }}
        >
          <PlusIcon />
          Instalar em mais repositórios
        </button>
      )}
    </section>
  );
}

function SummaryStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-[10px] border border-border2 bg-surface p-3">
      <span className="block font-mono text-[9px] uppercase tracking-[0.12em] text-faint">
        {label}
      </span>
      <strong className="mt-1 block text-lg font-semibold">{value}</strong>
    </div>
  );
}

function SearchIcon() {
  return (
    <svg aria-hidden width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="8" />
      <path d="m21 21-4.3-4.3" />
    </svg>
  );
}

function ArrowRightIcon() {
  return (
    <svg aria-hidden width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 12h14M12 5l7 7-7 7" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg aria-hidden width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg aria-hidden width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 5v14M5 12h14" />
    </svg>
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

function SkeletonList({ pageSize }: { pageSize: number }) {
  return (
    <ul className="grid">
      {Array.from({ length: pageSize }).map((_, i) => (
        <li
          key={i}
          className="min-h-[58px] animate-pulse border-b border-border/70 bg-surface"
        />
      ))}
    </ul>
  );
}

function countRepos(data: CatalogInstallations): { repos: number; managed: number } {
  const repos = data.groups.flatMap((g) => g.repos);
  return {
    repos: repos.length,
    managed: repos.filter((r) => r.managedProjectId !== null).length,
  };
}

export function catalogRows(data: CatalogInstallations): CatalogRepoRow[] {
  return data.groups.flatMap((group) =>
    group.repos.map((repo) => ({
      repo,
      account: group.account,
      accountType: group.accountType,
      tenantId: group.tenantId,
    })),
  );
}

export function filterCatalogRows(
  rows: CatalogRepoRow[],
  query: string,
  filter: CatalogFilter,
  sort: CatalogSort,
): CatalogRepoRow[] {
  const normalized = query.trim().toLowerCase();
  const filtered = rows.filter((row) => {
    const managed = row.repo.managedProjectId !== null;
    if (filter === 'managed' && !managed) return false;
    if (filter === 'unmanaged' && managed) return false;
    if (filter === 'private' && !row.repo.isPrivate) return false;
    if (!normalized) return true;

    return [
      row.account,
      row.repo.owner,
      row.repo.name,
      row.repo.description ?? '',
    ]
      .join(' ')
      .toLowerCase()
      .includes(normalized);
  });

  return [...filtered].sort((a, b) => {
    if (sort === 'name') {
      const byName = a.repo.name.localeCompare(b.repo.name, 'pt-BR');
      if (byName !== 0) return byName;
      return a.repo.owner.localeCompare(b.repo.owner, 'pt-BR');
    }
    if (sort === 'updated') {
      return pushedAtTime(b.repo) - pushedAtTime(a.repo);
    }

    const aManaged = a.repo.managedProjectId !== null ? 0 : 1;
    const bManaged = b.repo.managedProjectId !== null ? 0 : 1;
    if (aManaged !== bManaged) return aManaged - bManaged;
    return pushedAtTime(b.repo) - pushedAtTime(a.repo);
  });
}

function countCatalogRows(rows: CatalogRepoRow[]) {
  return rows.reduce(
    (acc, row) => {
      if (row.repo.managedProjectId !== null) acc.managed += 1;
      else acc.unmanaged += 1;
      if (row.repo.isPrivate) acc.private += 1;
      return acc;
    },
    { managed: 0, unmanaged: 0, private: 0 },
  );
}

function pushedAtTime(repo: Repo): number {
  return repo.pushedAt ? new Date(repo.pushedAt).getTime() : 0;
}

