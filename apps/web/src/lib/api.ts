/**
 * Base da API. Exportada para a **página pública** `/b/:token` (FIX #136), que
 * chama a API com `fetch` cru: ela não pode passar pelo `request()` daqui, porque
 * esse trata 401 como "precisa logar" — e quem abre o link de briefing é o cliente
 * do prestador, que não tem conta.
 */
export const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3311';

export interface SessionTenant {
  id: string;
  accountLogin: string;
  role: 'owner' | 'member' | 'viewer';
}

export interface SessionUser {
  id: string;
  login: string;
  name: string | null;
  avatarUrl: string | null;
  tenants: SessionTenant[];
}

/**
 * Tenant ativo (SPEC-022). Setado ao entrar num projeto (via URL /t/:tenant). O
 * `request()` prefixa automaticamente as rotas de projeto — os callers seguem
 * montando `/projects/...` sem saber do tenant. As rotas globais (`/catalog`,
 * `/auth`, `/usage`, `/portfolio`) não são reescritas.
 */
let activeTenant: string | null = null;
export function setActiveTenant(tenantId: string | null): void {
  activeTenant = tenantId;
}
export function getActiveTenant(): string | null {
  return activeTenant;
}

/**
 * Solta o tenant **só se ele ainda for o que este chamador fixou** (FIX #230).
 *
 * ## A corrida que isto fecha
 *
 * Ao navegar entre rotas irmãs, o React monta a nova antes de desmontar a
 * velha. Com `setActiveTenant(null)` cru no cleanup, a ordem real é:
 *
 * 1. `AppShell` do Catálogo renderiza e fixa o tenant;
 * 2. `ClientsRoute` de Licenças desmonta e **zera o tenant recém-fixado**.
 *
 * O efeito era o item Dashboard sumindo do menu ao clicar em ProPlan vindo de
 * qualquer tela de cliente: `/dashboard` saía sem o prefixo `/t/:tenant`, a API
 * devolvia 404, e o `catch` do `useDashboardNav` deixava `hasClients` em
 * `false` — indistinguível da regra legítima da SPEC-035 §2.12 ("some sem
 * cliente nenhum"), que é o que fez o bug sobreviver a duas rodadas de conserto.
 *
 * Comparar antes de limpar resolve sem coordenação entre as rotas: quem sai só
 * apaga o próprio rastro, e quem chegou primeiro continua valendo.
 */
export function clearActiveTenant(tenantId: string | null): void {
  if (activeTenant === tenantId) activeTenant = null;
}

export interface Repo {
  githubRepoId: number;
  owner: string;
  name: string;
  description: string | null;
  defaultBranch: string;
  isPrivate: boolean;
  pushedAt: string | null;
  installationId: number;
  managedProjectId: string | null;
}

/** Um grupo do catálogo = uma instalação do App em uma conta (ADR-015). */
export interface InstallationGroup {
  installationId: number;
  tenantId: string | null;
  account: string;
  accountType: 'User' | 'Organization';
  repos: Repo[];
}

export interface CatalogInstallations {
  groups: InstallationGroup[];
  empty: boolean;
}

/**
 * Ids canônicos + slugs canônicos (lowercase) de uma rota de workspace
 * (SPEC-028). Os **ids** são o que vai para `setActiveTenant` e para as
 * chamadas de projeto; os **slugs** são o que a barra de endereço mostra.
 */
export interface ResolvedRoute {
  tenantId: string;
  projectId: string;
  tenantSlug: string;
  projectSlug: string;
}

/**
 * Rotas ESCOPADAS por tenant — recebem o prefixo `/t/:tenant` (SPEC-022). As
 * globais (`/catalog`, `/auth`, `/usage`, `/portfolio`, `/resolve`) e a pública
 * (`/b/:token`) passam intactas: a pública não tem tenant por design (o dela vem
 * do hash do token, ADR-020). Sem tenant ativo o path fica como está — o backend
 * responde 401/403 e o app redireciona ao catálogo.
 */
const TENANT_SCOPED_PREFIXES = [
  '/projects/',
  '/clients',
  '/client-projects',
  '/briefing-versions',
  '/files/',
  // SPEC-032 §6: as rotas de artefato vivem sob `/t/:tenant`. Sem esta linha,
  // `/artifacts/:id/...` sai SEM o prefixo e a API devolve 404 — ver versão,
  // aprovar, rejeitar e editar param todas de funcionar. A lista continuava OK
  // porque o caminho dela começa com `/client-projects`, que já estava aqui.
  '/artifacts/',
  // SPEC-033 §6: estimativa e parâmetros também vivem sob `/t/:tenant`. Sem
  // estas duas linhas, `/estimates/:id/approve` e `/tenant-settings` saem SEM o
  // prefixo e a API devolve 404 — com falha muda em tela, porque todos os testes
  // do web mockam esta camada e nenhum deles passa por aqui. É literalmente o
  // FIX #166, e o motivo de ele estar anotado logo acima.
  '/estimates/',
  '/tenant-settings',
  // SPEC-034 §6: perfil, templates e contratos vivem sob `/t/:tenant`. Mesma
  // armadilha das duas linhas acima — `/contracts/:id/link` e
  // `/contracts/:id/acceptance` sairiam sem o prefixo e o aceite falharia mudo.
  // `/client-projects` já cobre emitir e listar.
  '/contracts/',
  '/contract-templates',
  '/provider-profile',
  // SPEC-035 §6: o dashboard inteiro vive sob `/t/:tenant`. Uma linha só cobre
  // as três rotas (`/dashboard`, `/dashboard/pending-count`,
  // `/dashboard/settings`) porque todas partem do mesmo prefixo — e sem ela o
  // contador do menu sairia sem tenant e mostraria zero em silêncio, que é
  // exatamente pior do que não existir (§2.3).
  '/dashboard',
  // SPEC-036 §Contratos: o admin do licenciamento vive sob `/t/:tenant`. A
  // rota PÚBLICA (`/licensing/v1/activate`) não entra aqui de propósito — ela
  // roda sem sessão e não é chamada por esta web, e sim pelo binário na
  // máquina do comprador.
  '/licensing/',
];

/**
 * Exportada para teste. A lista acima é fácil de esquecer ao adicionar rotas —
 * e o efeito é silencioso: a chamada sai sem tenant, a API devolve 404, e a
 * tela mostra vazio sem erro. Aconteceu com `/artifacts/` no dogfooding da
 * SPEC-032, e nenhum teste pegou porque todos mockam a camada de API inteira,
 * que é justamente onde esta função vive.
 */
export function withTenantPrefix(path: string): string {
  if (activeTenant && TENANT_SCOPED_PREFIXES.some((p) => path.startsWith(p))) {
    return `/t/${activeTenant}${path}`;
  }
  return path;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}${withTenantPrefix(path)}`, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
  if (res.status === 401) throw new UnauthorizedError();
  if (!res.ok) throw new Error(`API ${res.status}: ${await res.text()}`);
  if (res.status === 204) return undefined as T;
  // Nest serializa retorno null/undefined como corpo vazio — não quebrar no json().
  const text = await res.text();
  return (text ? JSON.parse(text) : null) as T;
}

export class UnauthorizedError extends Error {}

export type Entity = 'architecture' | 'decisions' | 'design' | 'testing' | 'deploy' | 'skills';
export type TabSourceKind = 'convention' | 'alias' | 'config' | 'inference' | 'absent';

export interface TabSource {
  level: 1 | 2 | 3 | 4;
  source: TabSourceKind;
  path: string | null;
  paths: string[];
  confidence: number;
}
export interface TabResponse<P = unknown> {
  source: TabSource;
  payload: P | null;
}

/** Presente no payload de uma aba quando a resolução é nível 3 (inferência de IA, ADR-014). */
export interface InferencePayload {
  inferred: true;
  spans: string[];
}

/**
 * Veredito do confronto doc × SBOM (SPEC-023). Nenhum valor coroa uma fonte:
 * `discorda` mostra os dois lados, não elege o certo (ADR-018).
 */
export type StackVerdict = 'concorda' | 'discorda' | 'nao_declarado' | 'nao_detectado';

/** Bloco "Stack detectada" (SPEC-023), presente no payload da aba Arquitetura. */
export interface StackBlock {
  /** `false` = Dependency Graph desabilitado/vazio → estado informativo. */
  enabled: boolean;
  /** Origem do dado: detectado do manifest pelo GitHub, nunca declarado nem IA. */
  source: 'sbom';
  /** Ecossistemas detectados, ordenados por nº de pacotes. */
  ecosystems: string[];
  /** Ecossistemas que a documentação declara (lado "declarado" do confronto). */
  declared: string[];
  verdict: StackVerdict;
  packageCount: number;
  /** SHA do HEAD do default branch no momento da coleta. */
  sourceSha: string | null;
  observedAt: string | null;
}

export interface StackPackage {
  ecosystem: string;
  name: string;
  version: string | null;
}

/** Uma linha do mapeamento manual (Fatia 6, ADR-014): entidade + resolução atual + candidatos do repo. */
export interface MappingRow {
  entity: Entity;
  resolution: TabSource & { entity: Entity };
  candidates: string[];
}

export type DocKind = 'markdown' | 'pdf' | 'image' | 'html' | 'office' | 'binary';

export interface DocumentSummary {
  id: string;
  path: string;
  isConventional: boolean;
  byteSize: number;
  updatedAt: string;
  kind: DocKind;
}

export interface DocumentContent extends DocumentSummary {
  content: string;
  blobSha: string;
  frontmatter: Record<string, unknown> | null;
}

/** Operação assíncrona de escrita (SPEC-010): passos nomeados + polling por id. */
export type OperationKind = 'promote' | 'mapping' | 'bootstrap' | 'assertion' | 'board_mutation';
export type OperationStatus = 'running' | 'done' | 'failed';
export type StepStatus = 'pending' | 'running' | 'done' | 'failed';
export interface OperationStep {
  key: string;
  label: string;
  status: StepStatus;
}
export interface OperationView {
  id: string;
  kind: OperationKind;
  status: OperationStatus;
  steps: OperationStep[];
  commitUrl: string | null;
  syncRunId: string | null;
  error: string | null;
  startedAt: string;
  finishedAt: string | null;
}

/** Um item do histórico do painel de Atividade (SPEC-010, projeção de leitura). */
export type ActivityItemKind = 'operation' | 'insight_run' | 'board_mutation' | 'sync';
export interface ActivityItem {
  id: string;
  kind: ActivityItemKind;
  at: string;
  title: string;
  detail: string | null;
  evidenceUrl: string | null;
  /** Tokens/custo da chamada de IA (só linhas insight_run `generated`). */
  cost?: { inputTokens: number; outputTokens: number; costUsd: string | null } | null;
}
export interface ActivityFeed {
  items: ActivityItem[];
  nextCursor: string | null;
}

export type SyncStatus = 'queued' | 'running' | 'success' | 'noop' | 'failed';

export interface SyncRun {
  id: string;
  status: SyncStatus;
  docsScopeHash: string | null;
  added: number;
  updated: number;
  removed: number;
  skipped: number;
  error: string | null;
  startedAt: string;
  finishedAt: string | null;
}

/** Asserção humana (SPEC-015, ADR-013): fonte = docs/CONTEXT.md; a marca
 *  `a-revalidar` é obrigatória em toda exposição — nunca omitida. */
export interface Assertion {
  id: string;
  statement: string;
  paths: string[];
  author: string;
  assertedAt: string;
  assertedSha: string;
  status: 'vigente' | 'a-revalidar';
  body: string;
}

/** Estado da conexão GitHub (SPEC-025). Ausência de conexão é informação, não
 *  erro: o catálogo a lê para mostrar o CTA de conectar. */
export interface GithubConnection {
  connected: boolean;
}

export const api = {
  /** Entrada da sessão do app (SPEC-026) — a identidade é o IdP, não o GitHub. */
  googleLoginUrl: `${API_URL}/auth/google`,
  /** Conexão GitHub (ADR-015). Deixa de ser a porta de entrada: passa a ser
   *  disparada de dentro do painel, pelo catálogo (#93). */
  loginUrl: `${API_URL}/auth/github`,
  me: () => request<SessionUser>('/auth/me'),
  logout: () => request<void>('/auth/logout', { method: 'POST' }),
  /** Estado da conexão GitHub (SPEC-025) — decide entre catálogo vivo e read-only. */
  githubConnection: () =>
    request<GithubConnection>('/auth/connections/github'),
  /** Revoga a conexão GitHub. **Não** encerra a sessão — desconectar ≠ deslogar. */
  disconnectGithub: () =>
    request<GithubConnection>('/auth/connections/github/disconnect', {
      method: 'POST',
    }),
  installations: () =>
    request<CatalogInstallations>('/catalog/installations'),
  installUrl: () => request<{ url: string }>('/catalog/install-url'),
  addProject: (repo: Repo) =>
    request<{ id: string }>('/catalog/projects', {
      method: 'POST',
      body: JSON.stringify(repo),
    }),
  removeProject: (id: string) =>
    request<void>(`/catalog/projects/${id}`, { method: 'DELETE' }),
  projects: () => request<Project[]>('/catalog/projects'),
  /**
   * Traduz os tokens da URL (slug ou uuid) nos ids canônicos (SPEC-028). Rota
   * global: resolve o deep-link sem baixar o catálogo inteiro. 404 quando o
   * tenant/projeto não é do usuário ou não existe.
   */
  resolve: (tenant: string, project: string) =>
    request<ResolvedRoute>(
      `/resolve?tenant=${encodeURIComponent(tenant)}&project=${encodeURIComponent(project)}`,
    ),
  portfolio: () => request<PortfolioRow[]>('/portfolio'),
  sync: (projectId: string) =>
    request<{ syncRunId: string }>(`/projects/${projectId}/sync`, {
      method: 'POST',
    }),
  latestSyncRun: (projectId: string) =>
    request<SyncRun | null>(`/projects/${projectId}/sync-runs/latest`),
  documents: (projectId: string) =>
    request<DocumentSummary[]>(`/projects/${projectId}/documents`),
  documentContent: (projectId: string, path: string) =>
    request<DocumentContent>(
      `/projects/${projectId}/documents/content?path=${encodeURIComponent(path)}`,
    ),
  rawUrl: (projectId: string, path: string) =>
    `${API_URL}${withTenantPrefix(`/projects/${projectId}/documents/raw?path=${encodeURIComponent(path)}`)}`,
  docxText: (projectId: string, path: string) =>
    request<{ text: string }>(
      `/projects/${projectId}/documents/raw?path=${encodeURIComponent(path)}`,
    ),
  settings: () => request<Settings>('/settings'),
  usageCurrentMonth: () => request<CurrentMonthUsage>('/usage/llm/current-month'),
  usageReport: () => request<UsageReport>('/usage/llm'),
  modelPrices: () => request<ModelPrice[]>('/settings/model-prices'),
  upsertModelPrice: (input: {
    provider: string;
    model: string;
    inputPer1M: string;
    outputPer1M: string;
    cacheWritePer1M?: string;
    cacheReadPer1M?: string;
    source?: string;
  }) =>
    request<ModelPrice[]>('/settings/model-prices', {
      method: 'PUT',
      body: JSON.stringify(input),
    }),
  updateSettings: (
    input: Partial<Pick<Settings, 'llmProvider' | 'docsStalenessThresholdDays'>>,
  ) =>
    request<Settings>('/settings', {
      method: 'PUT',
      body: JSON.stringify(input),
    }),
  /** Teto de gasto do tenant (ADR-026). Rota própria — dono diferente de `/settings`. */
  llmCaps: () => request<TenantCaps>('/settings/llm-caps'),
  updateLlmCaps: (
    input: Partial<Pick<TenantCaps, 'llmAlertUsdMonthly' | 'llmHardCapUsdMonthly'>>,
  ) =>
    request<TenantCaps>('/settings/llm-caps', {
      method: 'PUT',
      body: JSON.stringify(input),
    }),
  freshness: (projectId: string) =>
    request<Freshness>(`/projects/${projectId}/freshness`),
  summary: (projectId: string) =>
    request<InsightSummary | null>(`/projects/${projectId}/insights/summary`),
  regenerateSummary: (projectId: string) =>
    request<InsightSummary | null>(
      `/projects/${projectId}/insights/summary/regenerate`,
      { method: 'POST' },
    ),
  graph: (projectId: string) =>
    request<DocGraph>(`/projects/${projectId}/graph`),
  suppressEdge: (projectId: string, sourcePath: string, targetPath: string) =>
    request<void>(`/projects/${projectId}/graph/edges`, {
      method: 'DELETE',
      body: JSON.stringify({ sourcePath, targetPath }),
    }),
  tab: <P = unknown>(projectId: string, tab: Entity) =>
    request<TabResponse<P>>(`/projects/${projectId}/tabs/${tab}`),
  /** SPEC-023: lista detalhada de dependências — só quando o usuário expande. */
  stackPackages: (projectId: string) =>
    request<{ enabled: boolean; packages: StackPackage[] }>(
      `/projects/${projectId}/tabs/stack/packages`,
    ),
  promote: (projectId: string, tab: Entity, content: string) =>
    request<{ operationId: string }>(`/projects/${projectId}/tabs/${tab}/promote`, {
      method: 'POST',
      body: JSON.stringify({ content }),
    }),
  operation: (operationId: string) =>
    request<OperationView>(`/operations/${operationId}`),
  activityRunning: (projectId: string) =>
    request<OperationView[]>(`/projects/${projectId}/activity/running`),
  activityFeed: (projectId: string, opts: { cursor?: string; includeSyncs?: boolean } = {}) => {
    const q = new URLSearchParams();
    if (opts.cursor) q.set('cursor', opts.cursor);
    if (opts.includeSyncs) q.set('includeSyncs', 'true');
    const qs = q.toString();
    return request<ActivityFeed>(`/projects/${projectId}/activity${qs ? `?${qs}` : ''}`);
  },
  // Contexto/asserção humana (SPEC-015)
  assertions: (projectId: string) =>
    request<{ assertions: Assertion[] }>(`/projects/${projectId}/assertions`),
  captureAssertion: (
    projectId: string,
    input: { statement: string; paths: string[]; body?: string },
  ) =>
    request<{ operationId: string }>(`/projects/${projectId}/assertions`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  revalidateAssertion: (projectId: string, assertionId: string) =>
    request<{ operationId: string }>(
      `/projects/${projectId}/assertions/${assertionId}/revalidate`,
      { method: 'POST' },
    ),

  mapping: (projectId: string) =>
    request<{ rows: MappingRow[]; proplanConfigInvalid: boolean }>(
      `/projects/${projectId}/tabs/mapping`,
    ),
  putMapping: (projectId: string, entity: Entity, path: string | null) =>
    request<{ operationId: string }>(`/projects/${projectId}/tabs/mapping`, {
      method: 'PUT',
      body: JSON.stringify({ entity, path }),
    }),

  // Board (Kanban sobre Issues — SPEC-005)
  board: (projectId: string) =>
    request<BoardView>(`/projects/${projectId}/board`),
  /** Detalhe do card — leitura ao vivo no GitHub, nada cacheado (SPEC-030). */
  cardDetail: (projectId: string, number: number) =>
    request<CardDetail>(`/projects/${projectId}/board/cards/${number}`),
  mutateBoard: (projectId: string, input: MutationInput) =>
    request<{ mutationId: string }>(`/projects/${projectId}/board/mutations`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  mutationStatus: (projectId: string, mutationId: string) =>
    request<BoardMutationState>(
      `/projects/${projectId}/board/mutations/${mutationId}`,
    ),
  previewImport: (projectId: string) =>
    request<CardToCreate[]>(`/projects/${projectId}/board/import-from-status`),
  applyImport: (projectId: string, cards: CardToCreate[]) =>
    request<{ operationId: string }>(
      `/projects/${projectId}/board/import-from-status`,
      { method: 'POST', body: JSON.stringify({ cards }) },
    ),
  proposeCards: (projectId: string) =>
    request<CardToCreate[]>(`/projects/${projectId}/board/bootstrap`, {
      method: 'POST',
    }),
  applyBootstrap: (projectId: string, cards: CardToCreate[]) =>
    request<{ operationId: string }>(`/projects/${projectId}/board/bootstrap/apply`, {
      method: 'POST',
      body: JSON.stringify({ cards }),
    }),
  // Handoff exportável (SPEC-018)
  handoff: (projectId: string) =>
    request<HandoffResponse>(`/projects/${projectId}/handoff`),
  commitHandoff: (projectId: string) =>
    request<{ committed: boolean }>(`/projects/${projectId}/handoff/commit`, {
      method: 'POST',
    }),
};

export type BoardColumn =
  | 'backlog'
  | 'todo'
  | 'doing'
  | 'done'
  | 'finalized'
  | 'discarded';
export type IssuePriority = 'alta' | 'media' | 'baixa';
export type BoardMode = 'active' | 'degraded' | 'no-installation';

export interface BoardCard {
  number: number;
  title: string;
  column: BoardColumn;
  priority: IssuePriority | null;
  assignee: { login: string; avatarUrl: string } | null;
  htmlUrl: string;
  /** Nascimento da issue no GitHub — carimbo do card fora de Finalizado/Descartado. */
  createdAt: string;
  closedAt: string | null;
  /** Fechada fora do ProPlan (closed sem label) — badge em Finalizado. */
  closedOutside: boolean;
  /** Número do épico-pai (null = raiz). A swimlane agrupa por este campo (SPEC-024). */
  parentNumber: number | null;
}

/* Detalhe do card (SPEC-030) — espelho do contrato da API. Lido sob demanda e
   descartado ao fechar a gaveta: nada disto existe no cache do board. */

export type CardEventType =
  | 'opened'
  | 'assigned'
  | 'unassigned'
  | 'labeled'
  | 'unlabeled'
  | 'closed'
  | 'reopened'
  | 'renamed';

export interface CardActor {
  login: string;
  avatarUrl: string;
}

export interface CardEvent {
  type: CardEventType;
  actor: CardActor | null;
  createdAt: string;
  label?: { name: string; color: string };
  assignee?: { login: string };
  rename?: { from: string; to: string };
}

export interface CardDetail {
  number: number;
  title: string;
  state: 'open' | 'closed';
  htmlUrl: string;
  /** Markdown cru da issue. `null` = sem descrição (vazio já vem normalizado). */
  body: string | null;
  author: CardActor | null;
  assignees: CardActor[];
  /** `color` é o hex do GitHub, sem `#` e sem tradução para token nosso. */
  labels: { name: string; color: string }[];
  createdAt: string;
  updatedAt: string;
  closedAt: string | null;
  timeline: CardEvent[];
  /** Carimbo da leitura — a gaveta o exibe para o humano saber que é ao vivo. */
  fetchedAt: string;
}

/** Épico = faixa da swimlane (issue com sub-issues), não card (SPEC-024). */
export interface BoardEpic {
  number: number;
  title: string;
  htmlUrl: string;
  /** Filhas fechadas / total — a faixa mostra `fechadas/total` (SPEC-024). */
  closedChildren: number;
  totalChildren: number;
}

export interface BoardView {
  mode: BoardMode;
  needsIssueImport: boolean;
  columns: { column: BoardColumn; cards: BoardCard[] }[];
  /** Épicos abertos, para renderizar as faixas da swimlane. */
  epics: BoardEpic[];
}

export interface BoardMutationState {
  id: string;
  status: 'queued' | 'applying' | 'applied' | 'failed';
  error: string | null;
  type: string;
}

export type MutationInput =
  | { type: 'move_column'; number: number; toColumn: BoardColumn }
  | { type: 'create_card'; title: string; column: BoardColumn; priority?: IssuePriority }
  | { type: 'edit_card'; number: number; title?: string; priority?: IssuePriority | null }
  | { type: 'discard_card'; number: number };

export interface CardToCreate {
  title: string;
  column: BoardColumn;
  priority?: IssuePriority | null;
}

export interface GraphNode {
  docId: string;
  path: string;
  isConventional: boolean;
  kind: 'readme' | 'claude' | 'doc';
}

export interface GraphEdge {
  source: string;
  target: string | null;
  targetPath: string;
  broken: boolean;
  kind: 'explicit' | 'inferred';
  reason: string | null;
}

export interface DocGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export type LlmProvider = 'anthropic' | 'openai' | 'openrouter';

/** Preferência de USUÁRIO. O teto de gasto saiu daqui (ADR-026) — ver `TenantCaps`. */
export interface Settings {
  llmProvider: LlmProvider;
  docsStalenessThresholdDays: number;
  availableProviders: LlmProvider[];
}

/**
 * Teto de gasto de IA do TENANT (ADR-026). Separado de `Settings` porque o dono
 * é outro: aquilo é escolha pessoal, isto é o bolso. `canEditCaps` vem do
 * servidor — só `owner` escreve, e a tela não deve oferecer o que a API recusa.
 */
export interface TenantCaps {
  llmAlertUsdMonthly: string;
  llmHardCapUsdMonthly: string;
  canEditCaps: boolean;
}

/** Gasto de IA do mês corrente (SPEC-009) — alimenta a barra e a faixa de alerta. */
export interface CurrentMonthUsage {
  costUsd: string;
  alertUsd: string;
  capUsd: string;
  blocked: boolean;
  missingPriceCount: number;
}

interface UsageBreakdown {
  costUsd: string;
  calls: number;
}
export interface UsageReport {
  totalCostUsd: string;
  totalCalls: number;
  totalTokens: number;
  wasteRatePct: string;
  missingPriceCount: number;
  byProviderModel: (UsageBreakdown & { provider: string; model: string })[];
  byKind: (UsageBreakdown & { kind: string })[];
  byStatus: (UsageBreakdown & { status: string })[];
  byProject: (UsageBreakdown & { projectId: string | null })[];
}

export interface ModelPrice {
  id: string;
  provider: string;
  model: string;
  inputPer1M: string;
  outputPer1M: string;
  cacheWritePer1M: string;
  cacheReadPer1M: string;
  effectiveFrom: string;
  source: string | null;
}

export interface Freshness {
  lastDocsCommitAt: string | null;
  lastCodeCommitAt: string | null;
  thresholdDays: number;
  stale: boolean;
}

export interface StateSummaryContent {
  oQueE: string;
  ondeParou: string;
  oQueFalta: string[];
}

export interface InsightSummary {
  id: string;
  provider: string;
  model: string;
  content: StateSummaryContent;
  createdAt: string;
}

export interface DecisionItem {
  title: string;
  status: string | null;
  date: string | null;
  path: string;
  anchor: string | null;
}

export interface DeployEnv {
  env: string;
  /** SPEC-017: componente (web, API, banco, cache…). Ausente → monolito. */
  componente?: string;
  status: string;
  platform: string;
  url: string | null;
}

/** SPEC-013 — drift de deploy: confronto de fontes, sem coroar verdade. */
export type DeploySource = 'doc' | 'repoConfig' | 'githubDeployments' | 'declaredUrl';
export type DeployVerdictState =
  | 'concordam'
  | 'discordam'
  | 'so_github_side'
  | 'omissa'
  | 'silencio';
/** SPEC-013.6: como a plataforma de uma URL declarada foi obtida. */
export type DeclaredUrlMode = 'string' | 'probe' | 'bloqueada_por_seguranca';
export interface DeploySignal {
  source: DeploySource;
  platforms: string[];
  observedAt: string;
  evidenceRef: string;
  mode?: DeclaredUrlMode;
}

export interface SkillEntry {
  name: string;
  description: string | null;
  path: string;
}

/** Handoff exportável (SPEC-018, Fatia 13.5). */
export type HandoffProvenance = 'fato' | 'inferencia' | 'hipotese' | 'assercao';

export interface HandoffConfidenceMath {
  stalenessDays: number;
  cobertura: number;
  contradicao: number;
  drift: number;
}

export interface HandoffIssueRef {
  number: number;
  url: string;
  title: string;
  capturedAt: string;
}

export type HandoffBlockBody =
  | {
      refused: false;
      value: string;
      provenance: HandoffProvenance;
      provenanceRef: unknown;
      confidence: number;
      math: HandoffConfidenceMath;
    }
  | {
      refused: true;
      reason: string;
      missing: unknown;
      confidence: number;
      math: HandoffConfidenceMath;
    };

export interface HandoffBlock {
  key: string;
  title: string;
  body: HandoffBlockBody;
  refs?: HandoffIssueRef[];
}

export interface Handoff {
  header: { generatedAt: string; docsScopeHash: string; notice: string };
  blocks: HandoffBlock[];
}

export interface HandoffResponse {
  structure: Handoff;
  markdown: string;
}

export interface WorkflowInfo {
  file: string;
  name: string;
  triggers: string[];
  jobs: { name: string; runsOn: string | null }[];
}

/** Projeto gerenciado como retornado por GET /catalog/projects. */
export interface Project {
  id: string;
  owner: string;
  name: string;
  description: string | null;
  defaultBranch: string;
  githubRepoId: number;
  installationId: number | null;
  installationStatus: 'active' | 'missing';
  needsIssueImport: boolean;
  docsScopeHash: string | null;
  lastSyncAt: string | null;
  /** SPEC-013 — veredito de drift de deploy (null enquanto nunca coletado). */
  deployVerdict: DeployVerdictState | null;
}

/** SPEC-019 — um sinal cru do radar: em vermelho? + quando foi lido. */
export interface PortfolioSignal {
  red: boolean;
  observedAt: string | null;
}

/** SPEC-019 — uma linha do portfólio, já ordenada pelo radar. */
export interface PortfolioRow {
  projectId: string;
  name: string;
  owner: string;
  stalenessDays: number | null;
  staleness: PortfolioSignal | null;
  coverage: PortfolioSignal | null;
  deploy: PortfolioSignal | null;
  ci: PortfolioSignal | null;
  redCount: number;
}

// ===========================================================================
// Frente Clientes (SPEC-029, Fatia 19)
// ===========================================================================

/** Os 10 estados internos do funil — mais finos que as 4 colunas da UI. */
export type ClientProjectState =
  | 'DRAFT'
  | 'LINK_SENT'
  | 'BRIEFING_STARTED'
  | 'BRIEFING_SUBMITTED'
  | 'ARTIFACTS_READY'
  | 'CONTRACT_PENDING'
  | 'CONTRACT_APPROVED'
  | 'IN_PRODUCTION'
  | 'DELIVERED'
  | 'ARCHIVED';

/** As 4 colunas do Kanban (SPEC-029 §Escopo). */
export type FunnelColumn = 'novo' | 'briefing' | 'prompt_contrato' | 'producao_entrega';

export interface Client {
  id: string;
  name: string;
  cpf: string | null;
  company: string | null;
  cnpj: string | null;
  email: string | null;
  phone: string | null;
  whatsapp: string | null;
  zipCode: string | null;
  street: string | null;
  district: string | null;
  city: string | null;
  state: string | null;
  notes: string | null;
  createdAt: string;
}

export interface ClientProject {
  id: string;
  clientId: string;
  title: string;
  description: string | null;
  state: ClientProjectState;
  createdAt: string;
  updatedAt: string;
}

export interface ClientDetail extends Client {
  projects: ClientProject[];
}

/** Card do funil: o projeto com o cliente embutido (o board é cross-cliente). */
export interface FunnelCard extends ClientProject {
  client: { id: string; name: string; company: string | null };
}

/**
 * Uma coluna do funil de clientes. Nome com prefixo `Funnel` porque
 * `BoardColumn` já é das colunas do board de REPOS — mesma disciplina que fez
 * `ClientProject` não reusar `Project` (ADR-023: domínios disjuntos).
 */
export interface FunnelBoardColumn {
  column: FunnelColumn;
  cards: FunnelCard[];
}

export interface ClientStatusTransition {
  id: string;
  fromState: ClientProjectState;
  toState: ClientProjectState;
  actorUserId: string | null;
  at: string;
}

/** Resposta da criação do link — `token` só existe AQUI, uma única vez. */
export interface CreatedBriefingLink {
  id: string;
  token: string;
  expiresAt: string | null;
}

export type BriefingLinkInfo =
  | { active: false }
  | {
      active: true;
      id: string;
      expiresAt: string | null;
      createdAt: string;
      status: 'valid' | 'expired' | 'revoked' | 'invalid';
    };

export function listClients(q?: string): Promise<Client[]> {
  const qs = q?.trim() ? `?q=${encodeURIComponent(q.trim())}` : '';
  return request<Client[]>(`/clients${qs}`);
}

export function getClient(id: string): Promise<ClientDetail> {
  return request<ClientDetail>(`/clients/${id}`);
}

export function createClient(input: Partial<Client>): Promise<Client> {
  return request<Client>('/clients', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function updateClient(id: string, input: Partial<Client>): Promise<Client> {
  return request<Client>(`/clients/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
}

export function deleteClient(id: string): Promise<{ deleted: boolean }> {
  return request<{ deleted: boolean }>(`/clients/${id}`, { method: 'DELETE' });
}

export function createClientProject(
  clientId: string,
  input: { title: string; description?: string | null },
): Promise<ClientProject> {
  return request<ClientProject>(`/clients/${clientId}/projects`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function getClientBoard(q?: string): Promise<{ columns: FunnelBoardColumn[] }> {
  const qs = q?.trim() ? `?q=${encodeURIComponent(q.trim())}` : '';
  return request<{ columns: FunnelBoardColumn[] }>(`/client-projects${qs}`);
}

/**
 * Move o card. A UI já atualizou otimisticamente; se isto rejeitar (422 de
 * transição inválida), o caller desfaz — é o rollback que a spec pede.
 */
export function transitionClientProject(
  id: string,
  target: { to?: ClientProjectState; column?: FunnelColumn },
): Promise<ClientProject> {
  return request<ClientProject>(`/client-projects/${id}/transition`, {
    method: 'POST',
    body: JSON.stringify(target),
  });
}

export function getClientProjectHistory(
  id: string,
): Promise<ClientStatusTransition[]> {
  return request<ClientStatusTransition[]>(`/client-projects/${id}/history`);
}

export function getBriefingLink(projectId: string): Promise<BriefingLinkInfo> {
  return request<BriefingLinkInfo>(`/client-projects/${projectId}/briefing-link`);
}

export function createBriefingLink(
  projectId: string,
  expiresAt?: string | null,
): Promise<CreatedBriefingLink> {
  return request<CreatedBriefingLink>(
    `/client-projects/${projectId}/briefing-link`,
    { method: 'POST', body: JSON.stringify({ expiresAt: expiresAt ?? null }) },
  );
}

export function revokeBriefingLink(projectId: string): Promise<{ revoked: number }> {
  return request<{ revoked: number }>(
    `/client-projects/${projectId}/briefing-link`,
    { method: 'DELETE' },
  );
}

/** Leitura do briefing no painel (SPEC-031 §6). Não existe par de escrita. */

export type BriefingState = 'not_started' | 'in_progress' | 'received';

export interface BriefingVersionRef {
  id: string;
  version: number;
  submittedAt: string;
}

export interface BriefingStatus {
  state: BriefingState;
  completedSteps: number | null;
  totalSteps: number;
  receivedAt: string | null;
  /** Mais nova primeiro; vazia enquanto nada foi enviado. */
  versions: BriefingVersionRef[];
}

export interface BriefingAttachmentRef {
  id: string;
  name: string;
  mime: string;
  size: number;
}

export interface BriefingVersionDetail {
  id: string;
  version: number;
  submittedAt: string;
  clientProjectId: string;
  answers: Record<string, Record<string, unknown>>;
  /**
   * Rótulo por `<etapa>.<campo>` — o servidor resolve `G` → "Comércio e
   * varejo". A tradução é da leitura: a versão é imutável.
   */
  labels: Record<string, string>;
  attachments: BriefingAttachmentRef[];
}

export function getBriefingStatus(projectId: string): Promise<BriefingStatus> {
  return request<BriefingStatus>(`/client-projects/${projectId}/briefing`);
}

export function getBriefingVersion(id: string): Promise<BriefingVersionDetail> {
  return request<BriefingVersionDetail>(`/briefing-versions/${id}`);
}

/** Artefatos gerados pelo pipeline de IA (SPEC-032 §2.12). */

export type ArtifactKind = 'normalize' | 'scope' | 'requirements' | 'site_prompt';
export type ArtifactState = 'PENDING_REVIEW' | 'APPROVED' | 'REJECTED' | 'FAILED';
export type ArtifactAuthor = 'ai' | 'human';

export interface ArtifactVersionRef {
  id: string;
  version: number;
  author: ArtifactAuthor;
  model: string | null;
  promptVersion: string | null;
  editedBy: string | null;
  parentVersionId: string | null;
  createdAt: string;
}

export interface ArtifactSummary {
  id?: string;
  kind: ArtifactKind;
  /**
   * `null` = a capacidade não rodou. **Diferente de `FAILED`**, que tentou e
   * falhou — colapsar os dois faria "ainda não usei" parecer "usei e deu
   * errado" (MVP3 §9).
   */
  state: ArtifactState | null;
  currentVersionId?: string | null;
  rejectionReason?: string | null;
  reviewedAt?: string | null;
  reviewedBy?: string | null;
  /** Mais nova primeiro. */
  versions: ArtifactVersionRef[];
}

export interface ArtifactRunRef {
  id: string;
  status: 'RUNNING' | 'COMPLETED' | 'FAILED';
  completedKinds: ArtifactKind[];
  /** Motivo legível em português — teto estourado, schema inválido. */
  failureReason: string | null;
  startedAt: string;
  finishedAt: string | null;
}

export interface ArtifactsOverview {
  artifacts: ArtifactSummary[];
  run: ArtifactRunRef | null;
  approvedCount: number;
  requiredCount: number;
  /** Do LEDGER, nunca derivado das versões (ADR-016). `null` sem run. */
  costUsd: string | null;
}

export interface ReviewVerdictRef {
  verdict: string;
  rationale: string;
  model: string | null;
  createdAt: string;
}

export interface ArtifactVersionDetail extends ArtifactVersionRef {
  content: Record<string, unknown>;
  artifact: { id: string; kind: ArtifactKind; state: ArtifactState };
  /** Parecer do revisor. **Nunca é gate de aprovação** — é conteúdo de tela. */
  verdicts: ReviewVerdictRef[];
}

export function getArtifacts(projectId: string): Promise<ArtifactsOverview> {
  return request<ArtifactsOverview>(`/client-projects/${projectId}/artifacts`);
}

export function getArtifactVersion(
  artifactId: string,
  versionId: string,
): Promise<ArtifactVersionDetail> {
  return request<ArtifactVersionDetail>(`/artifacts/${artifactId}/versions/${versionId}`);
}

export function approveArtifact(id: string): Promise<{ state: 'APPROVED'; cardMoved: boolean }> {
  return request(`/artifacts/${id}/approve`, { method: 'POST' });
}

export function rejectArtifact(
  id: string,
  reason: string,
): Promise<{ state: 'REJECTED'; cardMoved: boolean }> {
  return request(`/artifacts/${id}/reject`, {
    method: 'POST',
    body: JSON.stringify({ reason }),
  });
}

/**
 * Edição humana: **cria versão**, não altera no lugar (§2.10). `POST`, e não
 * `PATCH`, porque o verbo carrega a regra.
 */
export function createArtifactVersion(
  id: string,
  parentVersionId: string,
  content: Record<string, unknown>,
): Promise<{ id: string; version: number }> {
  return request(`/artifacts/${id}/versions`, {
    method: 'POST',
    body: JSON.stringify({ parentVersionId, content }),
  });
}

// ---------------------------------------------------------------------------
// SPEC-033 — Estimativa. Todo valor monetário trafega como STRING: serializado
// como número, um valor com muitas casas perderia precisão exatamente no dado
// que a fatia existe para manter exato.
// ---------------------------------------------------------------------------

/** Parâmetros de estimativa do workspace (§2.6). `canEdit` vem do servidor. */
export interface EstimateSettings {
  hourlyRateBrl: string;
  contingencyPercent: string;
  /** `null` é estado legítimo: sem câmbio, o custo de IA fica em USD. */
  exchangeRateUsdBrl: string | null;
  exchangeRateAt: string | null;
  canEdit: boolean;
}

export function getEstimateSettings(): Promise<EstimateSettings> {
  return request<EstimateSettings>('/tenant-settings');
}

/** Estado da decomposição de esforço + se o botão de gerar pode aparecer. */
export interface EffortBreakdownView {
  /** Resolvido no SERVIDOR: a rota recusa fora de `ARTIFACTS_READY` de qualquer jeito. */
  canGenerate: boolean;
  state: string;
  artifact: {
    id?: string;
    kind: 'effort_breakdown';
    state: ArtifactState | null;
    currentVersionId?: string | null;
    rejectionReason?: string | null;
    versions: ArtifactVersionRef[];
  };
  run: ArtifactRunRef | null;
}

/** Uma tarefa da decomposição, como a IA a propôs. */
export interface EffortTaskView {
  requisito: string;
  tarefa: string;
  horasMin: number;
  horasProvavel: number;
  horasMax: number;
  mvp: string;
}

/** Um cenário calculado. Todo valor é STRING — precisão de dinheiro. */
export interface ScenarioView {
  horasBrutas: string;
  horas: string;
  maoDeObraBrl: string;
  custosDiretosBrl: string;
  subtotalBrl: string;
  /** Linha própria e visível (§2.5) — nunca embutida no total. */
  contingenciaBrl: string;
  totalBrl: string;
}

export interface MvpGroupView {
  mvp: string;
  tarefas: number;
  horas: string;
  custoBrl: string;
}

export interface EstimateDetail {
  id: string;
  version: number;
  clientProjectId: string;
  effortVersionId: string;
  hourlyRateBrl: string;
  contingencyPercent: string;
  complexity: string;
  complexityFactor: string;
  exchangeRate: string | null;
  exchangeRateAt: string | null;
  directCosts: Array<{ label: string; valueBrl: string }>;
  aiCostIncurredUsd: string;
  /** `isCalculated` diz COMO o número veio — não que deixou de ser projeção. */
  aiCostProjected: { valueUsd: string; isCalculated: boolean };
  scenarios: { otimista: ScenarioView; provavel: ScenarioView; pessimista: ScenarioView };
  mvpBreakdown: MvpGroupView[];
  approvedAt: string | null;
  approvedBy: string | null;
  createdAt: string;
  createdBy: string | null;
}

export interface EstimateListItem {
  id: string;
  version: number;
  complexity: string;
  approvedAt: string | null;
  approvedBy: string | null;
  createdAt: string;
  createdBy: string | null;
  totalProvavelBrl: string | null;
}

export function getEffortBreakdown(projectId: string): Promise<EffortBreakdownView> {
  return request<EffortBreakdownView>(`/client-projects/${projectId}/effort-breakdown`);
}

export function generateEffortBreakdown(projectId: string): Promise<{ enqueued: true }> {
  return request(`/client-projects/${projectId}/effort-breakdown/generate`, {
    method: 'POST',
  });
}

export function listEstimates(
  projectId: string,
): Promise<{ estimates: EstimateListItem[] }> {
  return request(`/client-projects/${projectId}/estimates`);
}

export function getEstimate(id: string): Promise<EstimateDetail> {
  return request<EstimateDetail>(`/estimates/${id}`);
}

/** Calcula uma versão nova. **Sempre cria** — reestimar nunca sobrescreve. */
export function generateEstimate(
  projectId: string,
  input: {
    directCosts?: Array<{ label: string; valueBrl: string }>;
    aiCostProjectedUsd?: string;
  },
): Promise<EstimateDetail> {
  return request(`/client-projects/${projectId}/estimates/generate`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

/**
 * Aprova a estimativa. **Só este move o card** — o `approveArtifact` do
 * `effort_breakdown` é aprovação de artefato e não move nada.
 */
export function approveEstimate(
  id: string,
): Promise<{ approved: true; cardMoved: boolean; alreadyApproved: boolean }> {
  return request(`/estimates/${id}/approve`, { method: 'POST' });
}

/**
 * Altera os parâmetros. Só o `owner` — a API recusa os demais.
 *
 * `exchangeRateUsdBrl: null` **limpa** a taxa; omitir o campo não a toca. A
 * distinção viaja até aqui de propósito: cotação velha é pior que nenhuma, e
 * sem o `null` não haveria como voltar atrás depois de digitar uma vez.
 */
export function updateEstimateSettings(patch: {
  hourlyRateBrl?: string;
  contingencyPercent?: string;
  exchangeRateUsdBrl?: string | null;
}): Promise<EstimateSettings> {
  return request('/tenant-settings', {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
}

/**
 * URL do download do anexo. É um `<a href>` normal, não `fetch`: o browser
 * precisa receber o `Content-Disposition: attachment` para salvar o arquivo, e
 * o cookie `proplan_session` (httpOnly) vai junto por ser mesma origem de API.
 */
export function briefingAttachmentUrl(fileId: string): string {
  return `${API_URL}${withTenantPrefix(`/files/${fileId}`)}`;
}

// ---------------------------------------------------------------------------
// Contratos (SPEC-034 §6)
// ---------------------------------------------------------------------------

export type ContractModality =
  | 'desenvolvimento'
  | 'desenvolvimento_manutencao'
  | 'desenvolvimento_venda_codigo';

export type AcceptanceChannel = 'email' | 'whatsapp' | 'presencial' | 'telefone';

/** Perfil do prestador — um por tenant. `canEdit`/`exists` vêm do servidor. */
export interface ProviderProfileView {
  legalName: string;
  documentType: 'cpf' | 'cnpj';
  document: string;
  zipCode: string | null;
  street: string | null;
  district: string | null;
  city: string | null;
  state: string | null;
  email: string | null;
  phone: string | null;
  canEdit: boolean;
  /** `false` enquanto nunca foi preenchido — a emissão exige perfil. */
  exists: boolean;
}

export interface ProviderProfileInput {
  legalName: string;
  documentType: 'cpf' | 'cnpj';
  document: string;
  zipCode?: string;
  street?: string;
  district?: string;
  city?: string;
  state?: string;
  email?: string;
  phone?: string;
}

export interface TemplateSummary {
  modality: ContractModality;
  /** `true` enquanto o texto é o semeado — a trava do §2.3 lê isto. */
  isSeedExample: boolean;
  currentVersion: number | null;
  updatedAt: string;
  /** Se emitir contrato desta modalidade seria recusado. */
  readyToIssue: boolean;
}

export interface TemplateDetail extends TemplateSummary {
  body: string;
  canEdit: boolean;
}

export interface TemplateVersionView {
  id: string;
  version: number;
  body: string;
  createdBy: string | null;
  createdAt: string;
}

/** Valores monetários e horas são STRING — precisão preservada (§6). */
export interface ContractSummary {
  id: string;
  version: number;
  modality: ContractModality;
  budgetBrl: string;
  effortHours: string;
  paymentTerms: string | null;
  templateVersion: number;
  estimateVersion: number;
  acceptedAt: string | null;
  createdAt: string;
}

export interface ContractSnapshotParty {
  legalName?: string;
  document?: string;
  documentType?: string;
  [campo: string]: unknown;
}

export interface ContractDetail extends ContractSummary {
  renderedHtml: string;
  providerSnapshot: ContractSnapshotParty;
  clientSnapshot: ContractSnapshotParty;
}

/**
 * Estado do link ativo. **Nunca traz o token** — ele só existe em claro na
 * resposta de `createContractLink`, uma única vez.
 */
export type ContractLinkInfo =
  | { active: false }
  | {
      active: true;
      id: string;
      expiresAt: string;
      createdAt: string;
      status: 'valid' | 'expired' | 'revoked' | 'invalid';
    };

export function getProviderProfile(): Promise<ProviderProfileView> {
  return request<ProviderProfileView>('/provider-profile');
}

/** `PUT`: o perfil é substituído por inteiro, nunca remendado (§6). */
export function saveProviderProfile(
  input: ProviderProfileInput,
): Promise<ProviderProfileView> {
  return request('/provider-profile', {
    method: 'PUT',
    body: JSON.stringify(input),
  });
}

export function listContractTemplates(): Promise<TemplateSummary[]> {
  return request<TemplateSummary[]>('/contract-templates');
}

export function getContractTemplate(
  modality: ContractModality,
): Promise<TemplateDetail> {
  return request<TemplateDetail>(`/contract-templates/${modality}`);
}

export function listContractTemplateVersions(
  modality: ContractModality,
): Promise<TemplateVersionView[]> {
  return request<TemplateVersionView[]>(`/contract-templates/${modality}/versions`);
}

/**
 * Salva uma versão nova. **Nunca `PATCH`** — editar cria versão, e é este ato
 * que tira o `isSeedExample` e destrava a emissão da modalidade (§2.3).
 */
export function saveContractTemplateVersion(
  modality: ContractModality,
  body: string,
): Promise<TemplateDetail> {
  return request(`/contract-templates/${modality}/versions`, {
    method: 'POST',
    body: JSON.stringify({ body }),
  });
}

export function listContracts(
  projectId: string,
): Promise<ContractSummary[]> {
  return request<ContractSummary[]>(`/client-projects/${projectId}/contracts`);
}

export function getContract(id: string): Promise<ContractDetail> {
  return request<ContractDetail>(`/contracts/${id}`);
}

/**
 * Emite o snapshot. **Sempre cria versão nova** e **não move o card** (§2.6) —
 * quem move é o aceite.
 */
export function issueContract(
  projectId: string,
  input: { modality: ContractModality; paymentTerms?: string },
): Promise<ContractDetail> {
  return request(`/client-projects/${projectId}/contracts`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function getContractLink(contractId: string): Promise<ContractLinkInfo> {
  return request<ContractLinkInfo>(`/contracts/${contractId}/link`);
}

/**
 * Gera ou regenera. O `token` em claro vem **uma única vez** — regenerar revoga
 * o anterior, e nem o painel consegue reler o antigo.
 */
export function createContractLink(
  contractId: string,
): Promise<{ id: string; token: string; expiresAt: string }> {
  return request(`/contracts/${contractId}/link`, { method: 'POST' });
}

export function revokeContractLink(
  contractId: string,
): Promise<{ revoked: number }> {
  return request(`/contracts/${contractId}/link`, { method: 'DELETE' });
}

/**
 * Registra o aceite. **É o único ato da fatia que move o card**
 * (`CONTRACT_PENDING → CONTRACT_APPROVED`).
 */
export function acceptContract(
  contractId: string,
  input: { channel: AcceptanceChannel; note?: string },
): Promise<{ accepted: true; cardMoved: boolean; alreadyAccepted: boolean }> {
  return request(`/contracts/${contractId}/acceptance`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

/**
 * URL pública do contrato. Aponta para a **API**, não para o web.
 *
 * Diferente do briefing, cujo `/b/:token` é uma rota React: o contrato é
 * servido pelo Nest (`@Controller('c')`), que devolve o HTML já renderizado com
 * `no-store` e `noindex`. Montar esta URL sobre `window.location.origin`
 * produziria um link que cai no `Navigate to="/"` do `App.tsx` e leva o cliente
 * ao catálogo — que é o defeito simétrico ao que o `briefingUrl` documenta ter
 * pago uma vez, com os papéis trocados.
 */
export function contractPublicUrl(token: string): string {
  return `${API_URL}/c/${token}`;
}

// ===========================================================================
// Dashboard (SPEC-035, Fatia 24)
// ===========================================================================

/** Os 4 tipos da lista fechada de *Esperando você* (§2.3). */
export type PendingKind =
  | 'artifact_review'
  | 'estimate'
  | 'contract_acceptance'
  | 'stalled';

/**
 * Painel de destino do drill-down, ou `null` quando não há tela para onde levar.
 *
 * **Vem do servidor** — a tela não remonta este mapa a partir do `kind`. O §7.3
 * é a razão: *item cuja tela de destino não existe é texto, não link*, e quem
 * sabe se existe destino é quem produziu o item.
 */
export type PendingTarget = 'artefatos' | 'estimativa' | 'contratos' | null;

export interface PendingItem {
  kind: PendingKind;
  /** Cliente dono — a gaveta do drill-down é a dele. */
  clientId: string;
  clientProjectId: string;
  title: string;
  detail: string;
  target: PendingTarget;
  since: string;
}

export interface FunnelColumnCount {
  column: 'novo' | 'briefing' | 'prompt_contrato' | 'producao_entrega';
  count: number;
}

export interface DashboardContractCounts {
  issued: number;
  accepted: number;
  /**
   * Já emitiu algum contrato, em qualquer época.
   *
   * Separado de `issued` porque *"0 no período"* e *"você ainda não emitiu"* são
   * estados diferentes e a tela os mostra diferente (§2.7) — `COUNT(*)` devolve
   * `0` para os dois.
   */
  hasAny: boolean;
}

export interface DashboardActivityEntry {
  kind: 'funnel' | 'audit' | 'sync';
  at: string;
  title: string;
  detail: string;
  clientProjectId: string | null;
}

export type DashboardPeriod = '7' | '30' | '90' | 'current_month';

export interface DashboardView {
  period: DashboardPeriod;
  /** Tenant sem cliente nenhum — o item de menu some neste caso (§2.12). */
  hasAnyClient: boolean;
  activity: DashboardActivityEntry[];
  pending: PendingItem[];
  funnel: FunnelColumnCount[];
  contracts: DashboardContractCounts;
}

/** Blocos locais do dashboard — tudo menos repos, numa chamada só (§6). */
export function getDashboard(period?: DashboardPeriod): Promise<DashboardView> {
  return request(`/dashboard${period ? `?period=${period}` : ''}`);
}

/**
 * Só o contador, para o menu (§6).
 *
 * Rota separada porque é chamada a cada navegação e não deve arrastar o
 * dashboard inteiro junto — mas o número é, no servidor, o tamanho exato da
 * lista de `getDashboard().pending` (§2.3).
 */
export function getPendingCount(): Promise<{ count: number }> {
  return request('/dashboard/pending-count');
}

export interface DashboardSettings {
  stalledDays: number;
  /** Resolvido no servidor: só o `owner` altera (ADR-026). */
  canEdit: boolean;
}

export function getDashboardSettings(): Promise<DashboardSettings> {
  return request('/dashboard/settings');
}

export function updateDashboardSettings(
  stalledDays: number,
): Promise<DashboardSettings> {
  return request('/dashboard/settings', {
    method: 'PATCH',
    body: JSON.stringify({ stalledDays }),
  });
}

/**
 * Por que um repo não pôde ser lido (SPEC-035 §2.11).
 *
 * As três pedem **texto diferente** na tela. `rate_limit` em especial: o bloco
 * diz que o limite do GitHub foi atingido e quando volta — **nunca zero
 * silencioso**, que seria indistinguível de board vazio.
 */
export type RepoFailureKind = 'rate_limit' | 'timeout' | 'error';

export interface RepoBoardOk {
  status: 'ok';
  projectId: string;
  repo: string;
  columns: { column: string; count: number }[];
}

export interface RepoBoardFailed {
  status: 'failed';
  projectId: string;
  repo: string;
  reason: RepoFailureKind;
  /** Quando o limite volta — ISO. Só em `rate_limit`, e pode ser `null`. */
  retryAt: string | null;
}

export type RepoBoardResult = RepoBoardOk | RepoBoardFailed;

export interface ReposBlock {
  repos: RepoBoardResult[];
  /** Repos que existem mas não foram consultados por causa do teto (§2.11). */
  notLoaded: number;
}

/**
 * O bloco de repos, lido ao vivo no GitHub (§2.6).
 *
 * **Chamada separada de `getDashboard`, de propósito** (§6): a falha deste
 * bloco não pode contaminar a resposta principal, e a tela renderiza o resto
 * enquanto este carrega — ou falha.
 */
export function getDashboardRepos(): Promise<ReposBlock> {
  return request('/dashboard/repos');
}

// ===========================================================================
// Licenciamento (SPEC-036, Fatia 25 — MVP4)
//
// Só o ADMIN vive aqui. A rota pública `/licensing/v1/activate` é chamada pelo
// binário na máquina do comprador, nunca por esta web.
// ===========================================================================

export type LicBillingModel = 'PERPETUAL' | 'SUBSCRIPTION';
export type LicenseStatus = 'ACTIVE' | 'REVOKED' | 'EXPIRED';

export interface LicEditionView {
  id: string;
  slug: string;
  name: string;
  billingModel: LicBillingModel;
  maxMachines: number;
  updatesMonths: number;
  /**
   * Esta edição dá acesso ao repositório de código-fonte? (SPEC-039.)
   *
   * É o que o webhook lê para agendar o convite na compra. Sem ver o valor não há
   * como corrigi-lo, e o modo de errar é mudo: a venda chega, a licença sai sem
   * agendamento, e o comprador nunca recebe o convite.
   */
  grantsSourceAccess: boolean;
  /** Quantas licenças já saíram desta edição — o que impede apagá-la. */
  licenseCount: number;
}

export interface LicProductView {
  id: string;
  slug: string;
  name: string;
  keyPrefix: string;
  /**
   * `owner/name` do repositório de código-fonte, ou `null` (SPEC-039).
   *
   * `null` é a causa de o convite não ter destino — sem este campo na tela, o
   * operador só descobriria isso no teste de conexão, depois de cadastrar o PAT.
   */
  sourceRepo: string | null;
  editions: LicEditionView[];
}

export interface LicCatalogResponse {
  products: LicProductView[];
  /**
   * `false` = servidor sem chave de assinatura. A tela avisa **antes** de
   * alguém emitir e entregar uma chave que devolveria 503 na ativação.
   */
  signingConfigured: boolean;
}

export interface LicenseView {
  id: string;
  status: LicenseStatus;
  customerEmail: string;
  customerName: string | null;
  editionSlug: string;
  editionName: string;
  productSlug: string;
  issuedAt: string;
  updatesUntil: string;
  expiresAt: string | null;
  revokedAt: string | null;
  revokedReason: string | null;
  activeMachines: number;
  maxMachines: number;
}

/**
 * O que a emissão devolve — o **único** tipo com a chave em claro. Ela existe
 * nesta resposta e em nenhum outro lugar: o banco guarda só o hash, e nenhum
 * `GET` a devolve. Perder significa emitir outra.
 */
export interface IssuedLicense extends LicenseView {
  key: string;
}

export interface LicEventView {
  id: string;
  type: string;
  payload: unknown;
  createdAt: string;
}

export function getLicensingCatalog(): Promise<LicCatalogResponse> {
  return request('/licensing/catalog');
}

export function createLicProduct(input: {
  slug: string;
  name: string;
  keyPrefix: string;
}): Promise<LicProductView> {
  return request('/licensing/products', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

/**
 * Define ou limpa o repositório de código-fonte do produto (FIX #212).
 *
 * String vazia limpa (`null` no banco): desconfigurar é ação legítima — o produto
 * deixou de vender código-fonte — e não pode exigir SQL.
 */
export function updateProductSourceRepo(
  productId: string,
  sourceRepo: string,
): Promise<LicProductView> {
  return request(`/licensing/products/${productId}/source-repo`, {
    method: 'PATCH',
    body: JSON.stringify({ sourceRepo }),
  });
}

/**
 * Releases do produto (SPEC-041) — o **ponteiro** para o artefato, nunca o
 * artefato. Os bytes vivem na Release privada do GitHub (ADR-028).
 */
export interface LicReleaseView {
  id: string;
  productId: string;
  version: string;
  os: string;
  releasedAt: string;
  assetId: string;
  sha256: string;
  notes: string | null;
  published: boolean;
}

export function listLicReleases(productId?: string): Promise<LicReleaseView[]> {
  const q = productId ? `?productId=${encodeURIComponent(productId)}` : '';
  return request(`/licensing/releases${q}`);
}

export function createLicRelease(input: {
  productId: string;
  version: string;
  os: string;
  releasedAt: string;
  assetId: string;
  sha256: string;
  notes?: string;
}): Promise<LicReleaseView> {
  return request('/licensing/releases', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

/**
 * Despublica: some do `check` E do `download`. **Não apaga** — a trilha de quem
 * já baixou aponta para a linha, e o artefato segue no GitHub.
 */
export function unpublishLicRelease(id: string): Promise<LicReleaseView> {
  return request(`/licensing/releases/${id}/unpublish`, { method: 'POST' });
}

export function publishLicRelease(id: string): Promise<LicReleaseView> {
  return request(`/licensing/releases/${id}/publish`, { method: 'POST' });
}

export function createLicEdition(
  productId: string,
  input: {
    slug: string;
    name: string;
    billingModel?: LicBillingModel;
    maxMachines?: number;
    updatesMonths?: number;
  },
): Promise<LicEditionView> {
  return request(`/licensing/products/${productId}/editions`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function updateLicEditionLimits(
  editionId: string,
  input: {
    maxMachines?: number;
    updatesMonths?: number;
    /** FIX #214 — campo omitido não é tocado; `false` explícito desliga. */
    grantsSourceAccess?: boolean;
  },
): Promise<LicEditionView> {
  return request(`/licensing/editions/${editionId}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
}

/**
 * Busca de licenças (SPEC-040). **Um campo só, cinco colunas**: e-mail, nome,
 * `saleRef`, username do GitHub e a chave — esta hasheada no servidor, que
 * nunca a guardou em claro.
 *
 * Os antigos `email` e `key` separados sumiram: eram dois campos para uma
 * pergunta só, e colar no errado devolvia lista vazia — indistinguível de "esse
 * cliente não existe".
 */
export function listLicenses(filtro?: {
  q?: string;
  status?: LicenseStatus;
}): Promise<LicenseView[]> {
  const params = new URLSearchParams();
  if (filtro?.q) params.set('q', filtro.q);
  if (filtro?.status) params.set('status', filtro.status);
  const query = params.toString();
  return request(`/licensing/licenses${query ? `?${query}` : ''}`);
}

/** **A resposta contém a chave em claro — uma única vez.** */
export function issueLicense(input: {
  editionId: string;
  customerEmail: string;
  customerName?: string;
}): Promise<IssuedLicense> {
  return request('/licensing/licenses', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function revokeLicense(id: string, reason: string): Promise<LicenseView> {
  return request(`/licensing/licenses/${id}/revoke`, {
    method: 'POST',
    body: JSON.stringify({ reason }),
  });
}

export function listLicenseEvents(id: string): Promise<LicEventView[]> {
  return request(`/licensing/licenses/${id}/events`);
}

export interface ExtendResult {
  id: string;
  expiresAt: string | null;
  /** O que estava lá antes — a tela mostra os dois para o operador conferir. */
  previousExpiresAt: string | null;
}

/**
 * Estende a validade — **conserto pontual, não segunda fonte de verdade**
 * (SPEC-040 §Estender).
 *
 * `expiresAt` tem uma autoridade: a plataforma. A próxima renovação
 * **sobrescreve** esta data, e a tela precisa dizer isso ANTES da confirmação —
 * o operador não pode descobrir depois que prometeu ao cliente uma data que
 * volta sozinha.
 */
export function extendLicense(
  id: string,
  input: { until: string; reason: string },
): Promise<ExtendResult> {
  return request(`/licensing/licenses/${id}/extend`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export interface AnonymizeResult {
  id: string;
  mailDeliveries: number;
  webhookEvents: number;
}

/** Os quatro períodos das métricas. Lista fechada — o servidor recusa o resto. */
export type LicensingPeriod = '7' | '30' | '90' | 'current_month';

export interface LicDailyCount {
  /** `YYYY-MM-DD` **no fuso de São Paulo** — o rótulo que a tela mostra. */
  day: string;
  count: number;
}

/**
 * As contagens do painel (SPEC-040 §Métricas).
 *
 * **Nenhum campo de valor, e é deliberado.** Preço não é do ProPlan (decisão #4
 * do MVP4): vive no payload do webhook, sem coluna tipada nem moeda
 * normalizada. Um total derivado dali seria plausível e indefensável. No lugar
 * dele a tela leva link para a plataforma, que é onde dinheiro se confere.
 */
export interface LicensingSummary {
  period: LicensingPeriod;
  activationsByDay: LicDailyCount[];
  licensesByStatus: { active: number; revoked: number; expired: number };
  /** Contagem de eventos da plataforma na janela. Nunca valor. */
  sales: { approved: number; refunded: number; chargeback: number };
  subscriptions: { active: number; pastDue: number };
  activeMachines: number;
  sourceAccess: Record<string, number>;
  /**
   * **Zero é resultado; ausência é outra coisa.** Viaja fora do recorte de
   * período porque responde *"já houve alguma vez"* — que nenhuma janela
   * responde. Sem ele a tela mostraria "0 vendas" para quem nunca vendeu, e o
   * operador leria como queda.
   */
  everSold: boolean;
}

export function getLicensingSummary(
  period?: LicensingPeriod,
): Promise<LicensingSummary> {
  return request(`/licensing/summary${period ? `?period=${period}` : ''}`);
}


/**
 * Exclusão a pedido (LGPD, SPEC-040 §Exclusão a pedido).
 *
 * **Anonimiza, não deleta.** Saem e-mail, nome e username; ficam a licença, as
 * ativações, a trilha e o `saleRef` — o direito é sobre dado pessoal, não sobre
 * o fato da transação.
 *
 * **Irreversível.** A tela exige digitar o e-mail do titular e declara os
 * efeitos antes: a licença deixa de receber e-mail (não há destino) e reemitir
 * chave para de funcionar pelo fluxo normal.
 */
export function anonymizeLicense(
  id: string,
  input: { reason: string },
): Promise<AnonymizeResult> {
  return request(`/licensing/licenses/${id}/anonymize`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

// ===========================================================================
// Operação do webhook (SPEC-038, PR-5)
// ===========================================================================

/** Uma entrega da plataforma, como a lista a mostra (sem o payload bruto). */
export interface WebhookEventView {
  id: string;
  platform: string;
  eventType: string;
  externalEventId: string;
  status: 'PENDING' | 'PROCESSED' | 'FAILED' | 'IGNORED';
  error: string | null;
  receivedAt: string;
  processedAt: string | null;
  licenseId: string | null;
}

/** A entrega com o corpo bruto que a plataforma mandou. */
export interface WebhookEventDetail extends WebhookEventView {
  payload: unknown;
}

export function listWebhookEvents(status?: string): Promise<WebhookEventView[]> {
  const query = status ? `?status=${encodeURIComponent(status)}` : '';
  return request(`/licensing/webhook-events${query}`);
}

export function getWebhookEvent(id: string): Promise<WebhookEventDetail> {
  return request(`/licensing/webhook-events/${id}`);
}

export function reprocessWebhookEvent(id: string): Promise<{ enqueued: true }> {
  return request(`/licensing/webhook-events/${id}/reprocess`, { method: 'POST' });
}

/**
 * Configuração do webhook do tenant.
 *
 * **O segredo não vem** — só se está configurado. Ele é o Token que a Kiwify
 * gera, então a origem é o painel dela; a tela nunca precisa lê-lo de volta.
 */
export interface LicSettingsView {
  webhookSecretSet: boolean;
  /** `null` = o ProPlan não corta por atraso (decisão PI #3). */
  pastDueToleranceDays: number | null;
}

export function getLicensingSettings(): Promise<LicSettingsView> {
  return request('/licensing/settings');
}

/**
 * Grava segredo e/ou tolerância. **Campo omitido não é tocado**, e
 * `pastDueToleranceDays: null` é o que DESLIGA o corte — por isso os dois casos
 * têm de ser distinguíveis aqui também.
 */
export function updateLicensingSettings(input: {
  webhookSecret?: string;
  pastDueToleranceDays?: number | null;
}): Promise<LicSettingsView> {
  return request('/licensing/settings', {
    method: 'PUT',
    body: JSON.stringify(input),
  });
}

/** Mapeamento oferta→edição, com a edição já resolvida para a tela. */
export interface OfferMappingView {
  id: string;
  platform: string;
  externalProductId: string;
  /** `null` = curinga: qualquer oferta daquele produto. */
  externalOfferId: string | null;
  editionId: string;
  createdAt: string;
  edition: { id: string; slug: string; name: string };
}

export function listOfferMappings(): Promise<OfferMappingView[]> {
  return request('/licensing/offer-mappings');
}

export function createOfferMapping(input: {
  externalProductId: string;
  externalOfferId?: string | null;
  editionId: string;
}): Promise<OfferMappingView> {
  return request('/licensing/offer-mappings', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function deleteOfferMapping(id: string): Promise<{ deleted: true }> {
  return request(`/licensing/offer-mappings/${id}`, { method: 'DELETE' });
}

/** Uma máquina ativada, como o admin a vê (SPEC-037). */
export interface ActivationView {
  id: string;
  fingerprint: string;
  hostname: string | null;
  appVersion: string | null;
  activatedAt: string;
  lastSeenAt: string;
  /** Preenchido = fora da contagem de vagas, mas ainda legível aqui. */
  deactivatedAt: string | null;
}

/** Uma entrega de e-mail desta licença (SPEC-040). */
export interface MailDeliveryView {
  id: string;
  to: string;
  template: string;
  subject: string;
  status: string;
  attempts: number;
  error: string | null;
  createdAt: string;
  sentAt: string | null;
}

/**
 * Detalhe da licença — **responde "o que aconteceu com este cliente" numa
 * resposta só** (SPEC-040 §Busca e detalhe): máquinas, acesso ao source,
 * e-mails enviados e a trilha completa.
 */
export interface LicenseDetail extends LicenseView {
  activations: ActivationView[];
  /** Desativações + reativações na janela. **Sinal, não limite** — nada bloqueia. */
  swapCount: number;
  swapWindowDays: number;
  sourceAccess: string;
  githubUsername: string | null;
  sourceAccessError: string | null;
  sourceInviteAt: string | null;
  saleRef: string | null;
  pastDueAt: string | null;
  mailDeliveries: MailDeliveryView[];
  events: LicEventView[];
}

export function getLicenseDetail(id: string): Promise<LicenseDetail> {
  return request(`/licensing/licenses/${id}`);
}

/**
 * Acesso ao repo source (SPEC-039 PR-5).
 *
 * Uma licença que **pede gente**. O `reason` vem do servidor, não é deduzido do
 * enum aqui: a regra de "o que é pendência" mora num lugar só, senão as duas
 * versões divergem na primeira mudança.
 */
export interface SourcePendingItem {
  licenseId: string;
  customerEmail: string;
  customerName: string | null;
  editionName: string;
  sourceAccess: string;
  githubUsername: string | null;
  sourceInviteAt: string | null;
  sourceAccessError: string | null;
  reason: 'awaiting_username' | 'invited_not_accepted' | 'failed';
}

export function listSourcePending(): Promise<SourcePendingItem[]> {
  return request('/licensing/source-pending');
}

/**
 * Grava ou substitui o username (decisão PI #4: **só pelo admin**).
 *
 * `previousInviteCanceled` diz se havia convite/colaborador anterior desfeito — a
 * tela precisa distinguir "gravei" de "gravei e cancelei o convite errado", porque
 * o segundo caso significa que alguém perdeu acesso agora.
 */
export function setLicenseGithubUsername(
  licenseId: string,
  username: string,
): Promise<{ username: string; previousInviteCanceled: boolean }> {
  return request(`/licensing/licenses/${licenseId}/github-username`, {
    method: 'PUT',
    body: JSON.stringify({ username }),
  });
}

/** O que uma rodada de reconciliação fez — o retorno de reemitir. */
export interface ReconcileResult {
  convidados: number;
  aceitos: number;
  falhas: number;
  aguardandoUsername: number;
}

/**
 * Reemite: dispara a **reconciliação do tenant**, não uma chamada avulsa. Por isso
 * o retorno é o resultado da rodada inteira — a tela não pode prometer "convidei
 * este" quando o efeito é maior que isso.
 */
export function reinviteSource(licenseId: string): Promise<ReconcileResult> {
  return request(`/licensing/licenses/${licenseId}/source-invite`, { method: 'POST' });
}

/** Revogação manual do acesso ao repo. Não toca o `status` da licença. */
export function removeSourceAccess(
  licenseId: string,
): Promise<{ outcome: 'invitation_canceled' | 'collaborator_removed' | 'nothing_to_do' | 'failed' }> {
  return request(`/licensing/licenses/${licenseId}/source-access`, { method: 'DELETE' });
}

/** Configuração de source. **O PAT não vem** — só se está configurado. */
export interface SourceSettingsView {
  githubPatSet: boolean;
  sourceRepo: string | null;
}

export function getSourceSettings(): Promise<SourceSettingsView> {
  return request('/licensing/source-settings');
}

export function setSourcePat(githubPat: string): Promise<SourceSettingsView> {
  return request('/licensing/source-settings/pat', {
    method: 'PUT',
    body: JSON.stringify({ githubPat }),
  });
}

/**
 * Teste de conexão do PAT.
 *
 * **`ok: false` não é erro HTTP** — é o resultado. O PAT fine-grained expira, e o
 * par "teste aqui + pendência `FAILED`" é o que torna a expiração visível antes da
 * primeira venda.
 */
export function testSourceConnection(): Promise<
  { ok: true; repo: string } | { ok: false; reason: string }
> {
  return request('/licensing/source-settings/test', { method: 'POST' });
}

/** Suporte manual: libera a vaga quando o self-service do cliente não resolve. */
export function deactivateActivation(
  licenseId: string,
  activationId: string,
): Promise<ActivationView> {
  return request(
    `/licensing/licenses/${licenseId}/activations/${activationId}/deactivate`,
    { method: 'POST' },
  );
}
