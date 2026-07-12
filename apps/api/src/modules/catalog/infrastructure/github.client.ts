import { Injectable, UnauthorizedException } from '@nestjs/common';

export interface RepoSummary {
  githubRepoId: number;
  owner: string;
  name: string;
  description: string | null;
  defaultBranch: string;
  isPrivate: boolean;
  pushedAt: string | null;
}

interface GithubRepo {
  id: number;
  name: string;
  description: string | null;
  default_branch: string | null;
  private: boolean;
  pushed_at: string | null;
  owner: { login: string };
}

const MAX_PAGES = 10; // 1000 repos — acima disso é outro produto

@Injectable()
export class GithubClient {
  /** Repos do usuário autenticado, ordenados por push mais recente. */
  async listRepos(token: string): Promise<RepoSummary[]> {
    const all: GithubRepo[] = [];
    let url: string | null =
      'https://api.github.com/user/repos?per_page=100&sort=pushed&direction=desc';

    for (let page = 0; url && page < MAX_PAGES; page++) {
      const res: Response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github+json',
        },
        signal: AbortSignal.timeout(10_000),
      });
      if (res.status === 401) throw new UnauthorizedException('Token GitHub inválido');
      if (!res.ok) throw new Error(`GitHub API ${res.status}`);
      all.push(...((await res.json()) as GithubRepo[]));
      url = nextLink(res.headers.get('link'));
    }

    return all.map((r) => ({
      githubRepoId: r.id,
      owner: r.owner.login,
      name: r.name,
      description: r.description,
      defaultBranch: r.default_branch ?? 'main',
      isPrivate: r.private,
      pushedAt: r.pushed_at,
    }));
  }
}

/** Extrai a URL rel="next" do header Link da API do GitHub. */
function nextLink(header: string | null): string | null {
  if (!header) return null;
  const match = header.match(/<([^>]+)>;\s*rel="next"/);
  return match ? match[1] : null;
}
