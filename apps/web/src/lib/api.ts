const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3311';

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
 * Prefixa `/projects/...` com o tenant ativo (`/t/:tenant/projects/...`), SPEC-022.
 * Rotas globais passam intactas. Se não há tenant ativo, deixa como está — o
 * backend responde 401/403 e o app redireciona ao catálogo.
 */
function withTenantPrefix(path: string): string {
  if (activeTenant && path.startsWith('/projects/')) {
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

export const api = {
  loginUrl: `${API_URL}/auth/github`,
  me: () => request<SessionUser>('/auth/me'),
  logout: () => request<void>('/auth/logout', { method: 'POST' }),
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
    input: Partial<
      Pick<
        Settings,
        'llmProvider' | 'docsStalenessThresholdDays' | 'llmAlertUsdMonthly' | 'llmHardCapUsdMonthly'
      >
    >,
  ) =>
    request<Settings>('/settings', {
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

export interface Settings {
  llmProvider: LlmProvider;
  docsStalenessThresholdDays: number;
  llmAlertUsdMonthly: string;
  llmHardCapUsdMonthly: string;
  availableProviders: LlmProvider[];
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
