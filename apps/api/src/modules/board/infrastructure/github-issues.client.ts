import { Injectable, UnauthorizedException } from '@nestjs/common';

const TIMEOUT_MS = 10_000;
const MAX_PAGES = 20; // 2000 issues — acima disso, filtrar por since

export interface GithubIssue {
  number: number;
  title: string;
  state: 'open' | 'closed';
  labels: { name: string }[];
  assignees: { login: string; avatar_url: string }[];
  html_url: string;
  created_at: string;
  closed_at: string | null;
  updated_at: string;
  /** Presente ⇒ é PR, não issue (armadilha da REST API — descartar). */
  pull_request?: unknown;
  /** Número da issue-pai (épico), se esta for sub-issue. null = raiz (SPEC-024). */
  parentNumber?: number | null;
  /** Tem sub-issues ⇒ é épico estrutural, excluído das colunas (SPEC-024). */
  hasSubIssues?: boolean;
}

@Injectable()
export class GithubIssuesClient {
  /**
   * Lista todas as issues do repo (open+closed), **descartando PRs**
   * (`pull_request` no payload). Token do usuário — leitura (ADR-015).
   */
  async listIssues(
    userToken: string,
    owner: string,
    repo: string,
  ): Promise<GithubIssue[]> {
    const all: GithubIssue[] = [];
    let url: string | null = `https://api.github.com/repos/${owner}/${repo}/issues?state=all&per_page=100`;

    for (let page = 0; url && page < MAX_PAGES; page++) {
      const res: Response = await fetch(url, {
        headers: authHeaders(userToken),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (res.status === 401) throw new UnauthorizedException('Token GitHub inválido');
      if (!res.ok) throw new Error(`GitHub issues ${res.status}`);
      const batch = (await res.json()) as GithubIssue[];
      all.push(...batch.filter((i) => !i.pull_request));
      url = nextLink(res.headers.get('link'));
    }
    return all;
  }

  /**
   * Lista issues com a hierarquia de sub-issues (SPEC-024): cada issue carrega
   * `parentNumber` (épico-pai, se for sub-issue) e `hasSubIssues` (é épico).
   * Via GraphQL (`parent`/`subIssues`) — os campos são GA mas ainda opt-in pelo
   * header `GraphQL-Features: sub_issues`. Falha do GraphQL (shape mudou, feature
   * indisponível) → **fallback** para o REST `listIssues` (sem hierarquia, mas o
   * board volta a funcionar plano). Token do usuário — leitura (ADR-015).
   */
  async listIssuesWithHierarchy(
    userToken: string,
    owner: string,
    repo: string,
  ): Promise<GithubIssue[]> {
    try {
      return await this.listIssuesGraphql(userToken, owner, repo);
    } catch (err) {
      if (err instanceof UnauthorizedException) throw err;
      // Shape/feature indisponível: degrada para o board plano em vez de quebrar.
      return this.listIssues(userToken, owner, repo);
    }
  }

  private async listIssuesGraphql(
    userToken: string,
    owner: string,
    repo: string,
  ): Promise<GithubIssue[]> {
    const all: GithubIssue[] = [];
    let cursor: string | null = null;

    // `repository.issues` no GraphQL v4 traz só issues (PRs vivem em
    // `pullRequests`) — não precisa do filtro `pull_request` do REST.
    for (let page = 0; page < MAX_PAGES; page++) {
      const query = `query($owner:String!,$repo:String!,$cursor:String){
        repository(owner:$owner,name:$repo){
          issues(first:100,after:$cursor,states:[OPEN,CLOSED]){
            pageInfo{ hasNextPage endCursor }
            nodes{
              number title state url createdAt closedAt updatedAt
              labels(first:20){ nodes{ name } }
              assignees(first:10){ nodes{ login avatarUrl } }
              parent{ number }
              subIssues{ totalCount }
            }
          }
        }
      }`;
      const res = await fetch('https://api.github.com/graphql', {
        method: 'POST',
        headers: {
          ...authHeaders(userToken),
          'content-type': 'application/json',
          'GraphQL-Features': 'sub_issues',
        },
        body: JSON.stringify({ query, variables: { owner, repo, cursor } }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (res.status === 401) throw new UnauthorizedException('Token GitHub inválido');
      if (!res.ok) throw new Error(`GitHub GraphQL ${res.status}`);
      const body = (await res.json()) as GraphqlIssuesResponse;
      if (body.errors?.length) throw new Error(`GitHub GraphQL: ${body.errors[0].message}`);

      const conn = body.data?.repository?.issues;
      if (!conn) throw new Error('GitHub GraphQL: resposta sem issues');
      all.push(...conn.nodes.map(mapGraphqlIssue));

      if (!conn.pageInfo.hasNextPage) break;
      cursor = conn.pageInfo.endCursor;
    }
    return all;
  }

  /** `has_issues` do repo — false ⇒ modo degradado (SPEC-005). */
  async issuesEnabled(
    userToken: string,
    owner: string,
    repo: string,
  ): Promise<boolean> {
    const res = await fetch(`https://api.github.com/repos/${owner}/${repo}`, {
      headers: authHeaders(userToken),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (res.status === 401) throw new UnauthorizedException('Token GitHub inválido');
    if (!res.ok) throw new Error(`GitHub repo ${res.status}`);
    const body = (await res.json()) as { has_issues: boolean };
    return body.has_issues;
  }

  /** Cria issue (installation token — escrita, identidade bot). */
  async createIssue(
    installationToken: string,
    owner: string,
    repo: string,
    input: { title: string; labels: string[] },
  ): Promise<GithubIssue> {
    return this.write<GithubIssue>(
      installationToken,
      'POST',
      `https://api.github.com/repos/${owner}/${repo}/issues`,
      input,
    );
  }

  /** Patch de issue (título, estado, labels). Só campos presentes. */
  async patchIssue(
    installationToken: string,
    owner: string,
    repo: string,
    number: number,
    patch: { title?: string; state?: 'open' | 'closed'; labels?: string[] },
  ): Promise<GithubIssue> {
    return this.write<GithubIssue>(
      installationToken,
      'PATCH',
      `https://api.github.com/repos/${owner}/${repo}/issues/${number}`,
      patch,
    );
  }

  /**
   * Posta um comentário na issue (carimbo de aceite/descarte — SPEC-005).
   * Evidência permanente e auditável no GitHub, não cache. Installation token.
   */
  async comment(
    installationToken: string,
    owner: string,
    repo: string,
    number: number,
    body: string,
  ): Promise<void> {
    await this.write<unknown>(
      installationToken,
      'POST',
      `https://api.github.com/repos/${owner}/${repo}/issues/${number}/comments`,
      { body },
    );
  }

  /**
   * Cria uma label no repo. Idempotente: 422 (já existe) é tratado como sucesso
   * (SPEC-005). Só cria — não atualiza cor de label existente.
   */
  async ensureLabel(
    installationToken: string,
    owner: string,
    repo: string,
    name: string,
    color: string,
  ): Promise<void> {
    const res = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/labels`,
      {
        method: 'POST',
        headers: { ...authHeaders(installationToken), 'content-type': 'application/json' },
        body: JSON.stringify({ name, color }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      },
    );
    if (res.ok || res.status === 422) return; // 422 = já existe → sucesso
    throw new Error(`GitHub create label ${res.status}`);
  }

  private async write<T>(
    token: string,
    method: 'POST' | 'PATCH',
    url: string,
    body: unknown,
  ): Promise<T> {
    const res = await fetch(url, {
      method,
      headers: { ...authHeaders(token), 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (res.status === 401) throw new UnauthorizedException('Token GitHub inválido');
    if (!res.ok) throw new Error(`GitHub ${method} ${res.status}`);
    return (await res.json()) as T;
  }
}

function authHeaders(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' };
}

interface GraphqlIssueNode {
  number: number;
  title: string;
  state: 'OPEN' | 'CLOSED';
  url: string;
  createdAt: string;
  closedAt: string | null;
  updatedAt: string;
  labels: { nodes: { name: string }[] };
  assignees: { nodes: { login: string; avatarUrl: string }[] };
  parent: { number: number } | null;
  subIssues: { totalCount: number };
}

interface GraphqlIssuesResponse {
  data?: {
    repository?: {
      issues: {
        pageInfo: { hasNextPage: boolean; endCursor: string | null };
        nodes: GraphqlIssueNode[];
      };
    } | null;
  };
  errors?: { message: string }[];
}

/** Nó do GraphQL → o `GithubIssue` (formato REST) que o resto do board espera. */
function mapGraphqlIssue(n: GraphqlIssueNode): GithubIssue {
  return {
    number: n.number,
    title: n.title,
    state: n.state === 'CLOSED' ? 'closed' : 'open',
    labels: n.labels.nodes,
    assignees: n.assignees.nodes.map((a) => ({ login: a.login, avatar_url: a.avatarUrl })),
    html_url: n.url,
    created_at: n.createdAt,
    closed_at: n.closedAt,
    updated_at: n.updatedAt,
    parentNumber: n.parent?.number ?? null,
    hasSubIssues: n.subIssues.totalCount > 0,
  };
}

function nextLink(header: string | null): string | null {
  if (!header) return null;
  const match = header.match(/<([^>]+)>;\s*rel="next"/);
  return match ? match[1] : null;
}
