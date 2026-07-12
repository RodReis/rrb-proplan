import { Injectable, UnauthorizedException } from '@nestjs/common';

/** Cap de tamanho por documento de texto (SPEC-002 notas técnicas). */
export const MAX_BLOB_BYTES = 512 * 1024;

const GITHUB_TIMEOUT_MS = 10_000;
const MAX_RETRIES = 3;

export interface TreeBlob {
  path: string;
  blobSha: string;
}

interface TreeItem {
  path: string;
  type: string;
  sha: string;
}

/** Erro de negócio: repo grande demais para o perfil do produto. */
export class TreeTruncatedError extends Error {
  constructor() {
    super(
      'A árvore do repositório excede o limite da Trees API (repo fora do perfil do produto).',
    );
  }
}

/**
 * Cliente das Git Data APIs do GitHub (Trees + Blobs). Distinto do
 * `catalog/github.client` (que lista repos) — este lê conteúdo de docs.
 */
@Injectable()
export class GithubGitClient {
  /**
   * Árvore recursiva do branch (via ref name). Só blobs (arquivos).
   * `truncated: true` → falha o run com mensagem clara (SPEC-002).
   */
  async listTree(
    token: string,
    owner: string,
    repo: string,
    branch: string,
  ): Promise<TreeBlob[]> {
    const res = await this.fetchGithub(
      token,
      `https://api.github.com/repos/${owner}/${repo}/git/trees/${encodeURIComponent(branch)}?recursive=1`,
    );
    const body = (await res.json()) as {
      tree: TreeItem[];
      truncated: boolean;
    };
    if (body.truncated) throw new TreeTruncatedError();
    return body.tree
      .filter((it) => it.type === 'blob')
      .map((it) => ({ path: it.path, blobSha: it.sha }));
  }

  /**
   * Conteúdo de um blob (base64 via Git Blobs API, sem o limite de 1MB da
   * Contents API). Blob acima do cap → null (caller marca como skipped).
   */
  async getBlob(
    token: string,
    owner: string,
    repo: string,
    blobSha: string,
  ): Promise<{ content: string; byteSize: number } | null> {
    const res = await this.fetchGithub(
      token,
      `https://api.github.com/repos/${owner}/${repo}/git/blobs/${blobSha}`,
    );
    const body = (await res.json()) as {
      content: string;
      encoding: string;
      size: number;
    };
    if (body.size > MAX_BLOB_BYTES) return null;
    const buf =
      body.encoding === 'base64'
        ? Buffer.from(body.content, 'base64')
        : Buffer.from(body.content);
    return { content: buf.toString('utf-8'), byteSize: buf.byteLength };
  }

  /**
   * GET com timeout, tratamento de 401 e backoff em 403/429 respeitando
   * `x-ratelimit-reset` (ARCHITECTURE.md — resiliência).
   */
  private async fetchGithub(token: string, url: string): Promise<Response> {
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      const res = await fetch(url, {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github+json',
        },
        signal: AbortSignal.timeout(GITHUB_TIMEOUT_MS),
      });

      if (res.status === 401)
        throw new UnauthorizedException('Token GitHub inválido');

      if ((res.status === 403 || res.status === 429) && attempt < MAX_RETRIES) {
        await sleep(rateLimitDelayMs(res.headers, attempt));
        continue;
      }

      if (!res.ok) {
        throw new Error(`GitHub API ${res.status} em ${url}`);
      }
      return res;
    }
    throw new Error('GitHub API: limite de tentativas excedido (rate limit)');
  }
}

/** Delay do backoff: usa x-ratelimit-reset quando presente, senão exponencial. */
function rateLimitDelayMs(headers: Headers, attempt: number): number {
  const reset = headers.get('x-ratelimit-reset');
  if (reset) {
    const resetMs = Number(reset) * 1000 - Date.now();
    if (resetMs > 0) return Math.min(resetMs, 60_000);
  }
  return Math.min(1000 * 2 ** attempt, 30_000);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
