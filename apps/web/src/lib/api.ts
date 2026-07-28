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

/**
 * URL do download do anexo. É um `<a href>` normal, não `fetch`: o browser
 * precisa receber o `Content-Disposition: attachment` para salvar o arquivo, e
 * o cookie `proplan_session` (httpOnly) vai junto por ser mesma origem de API.
 */
export function briefingAttachmentUrl(fileId: string): string {
  return `${API_URL}${withTenantPrefix(`/files/${fileId}`)}`;
}
