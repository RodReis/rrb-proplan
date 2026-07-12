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
  managedProjectId: string | null;
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

export interface DocumentSummary {
  id: string;
  path: string;
  isConventional: boolean;
  byteSize: number;
  updatedAt: string;
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
  repos: () => request<Repo[]>('/catalog/repos'),
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
};

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

/** Projeto gerenciado como retornado por GET /catalog/projects. */
export interface Project {
  id: string;
  owner: string;
  name: string;
  description: string | null;
  defaultBranch: string;
  githubRepoId: number;
  docsScopeHash: string | null;
  lastSyncAt: string | null;
}
