const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3311';

export interface SessionUser {
  id: string;
  login: string;
  name: string | null;
  avatarUrl: string | null;
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
  account: string;
  accountType: 'User' | 'Organization';
  repos: Repo[];
}

export interface CatalogInstallations {
  groups: InstallationGroup[];
  empty: boolean;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
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
    `${API_URL}/projects/${projectId}/documents/raw?path=${encodeURIComponent(path)}`,
  docxText: (projectId: string, path: string) =>
    request<{ text: string }>(
      `/projects/${projectId}/documents/raw?path=${encodeURIComponent(path)}`,
    ),
  settings: () => request<Settings>('/settings'),
  updateSettings: (input: Partial<Pick<Settings, 'llmProvider' | 'docsStalenessThresholdDays'>>) =>
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
  proposeStatus: (projectId: string) =>
    request<{ content: string }>(`/projects/${projectId}/bootstrap/status`, {
      method: 'POST',
    }),
  commitStatus: (projectId: string, content: string) =>
    request<{ syncRunId: string }>(
      `/projects/${projectId}/bootstrap/status/commit`,
      { method: 'POST', body: JSON.stringify({ content }) },
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
  mapping: (projectId: string) =>
    request<{ rows: MappingRow[]; proplanConfigInvalid: boolean }>(
      `/projects/${projectId}/tabs/mapping`,
    ),
  putMapping: (projectId: string, entity: Entity, path: string | null) =>
    request<{ syncRunId: string }>(`/projects/${projectId}/tabs/mapping`, {
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
    request<{ created: number }>(
      `/projects/${projectId}/board/import-from-status`,
      { method: 'POST', body: JSON.stringify({ cards }) },
    ),
  proposeCards: (projectId: string) =>
    request<CardToCreate[]>(`/projects/${projectId}/board/bootstrap`, {
      method: 'POST',
    }),
  applyBootstrap: (projectId: string, cards: CardToCreate[]) =>
    request<{ created: number }>(`/projects/${projectId}/board/bootstrap/apply`, {
      method: 'POST',
      body: JSON.stringify({ cards }),
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
  closedAt: string | null;
}

export interface BoardView {
  mode: BoardMode;
  needsIssueImport: boolean;
  columns: { column: BoardColumn; cards: BoardCard[] }[];
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
  availableProviders: LlmProvider[];
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
  status: string;
  platform: string;
  url: string | null;
}

export interface SkillEntry {
  name: string;
  description: string | null;
  path: string;
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
}
