import {
  Injectable,
  PayloadTooLargeException,
  UnauthorizedException,
} from '@nestjs/common';
import { SbomResponse } from '../domain/stack-detect';

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
   * Nomes dos arquivos na raiz do repo (não-recursivo). Só metadado de path
   * (ADR-003) — usado pela SPEC-013 para detectar config de deploy (`vercel.json`,
   * `netlify.toml`, `Procfile`, …), que ficam fora do escopo `docs/`. Degrada
   * para lista vazia em erro.
   */
  async listRootFiles(
    token: string,
    owner: string,
    repo: string,
    branch: string,
  ): Promise<string[]> {
    const res = await this.fetchGithubOptional(
      token,
      `https://api.github.com/repos/${owner}/${repo}/git/trees/${encodeURIComponent(branch)}`,
    );
    if (!res) return [];
    const body = (await res.json()) as { tree?: TreeItem[] };
    return (body.tree ?? [])
      .filter((it) => it.type === 'blob')
      .map((it) => it.path);
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
    // Postgres text não aceita byte NUL (0x00). Documentos com NUL embutido
    // (encoding errado / binário) quebravam o sync inteiro — removemos.
    // O NUL é justamente o que estamos removendo; a regra existe para pegar
    // control char acidental numa regex, e este é deliberado.
    // eslint-disable-next-line no-control-regex
    const content = buf.toString('utf-8').replace(/\x00/g, '');
    return { content, byteSize: buf.byteLength };
  }

  /** Bytes crus de um blob (Buffer), sem decodificar como texto — para binários
   *  servidos sob demanda no preview. Teto de sanidade de 25 MB (stream efêmero,
   *  nunca persistido). Diferente de getBlob, que força utf-8 e é só para texto. */
  async getRawBlob(
    token: string,
    owner: string,
    repo: string,
    blobSha: string,
  ): Promise<Buffer> {
    const res = await this.fetchGithub(
      token,
      `https://api.github.com/repos/${owner}/${repo}/git/blobs/${blobSha}`,
    );
    const body = (await res.json()) as {
      content: string;
      encoding: string;
      size: number;
    };
    const MAX_RAW = 25 * 1024 * 1024;
    if (body.size > MAX_RAW)
      throw new PayloadTooLargeException(
        `Arquivo acima de 25 MB (${body.size} bytes) — pré-visualização indisponível.`,
      );
    return body.encoding === 'base64'
      ? Buffer.from(body.content, 'base64')
      : Buffer.from(body.content);
  }

  /**
   * Data do último commit do repo, opcionalmente filtrado por `path`
   * (ADR-010 — só metadado, nunca diff/conteúdo). null se não houver commit
   * no path (ex.: repo sem `docs`). Usar `docs` sem barra final (SPEC-003).
   */
  async getLastCommitDate(
    token: string,
    owner: string,
    repo: string,
    path?: string,
  ): Promise<Date | null> {
    const url = new URL(`https://api.github.com/repos/${owner}/${repo}/commits`);
    url.searchParams.set('per_page', '1');
    if (path) url.searchParams.set('path', path);
    const res = await this.fetchGithub(token, url.toString());
    const commits = (await res.json()) as Array<{
      commit: { committer?: { date?: string }; author?: { date?: string } };
    }>;
    if (!commits.length) return null;
    const date =
      commits[0].commit.committer?.date ?? commits[0].commit.author?.date;
    return date ? new Date(date) : null;
  }

  /**
   * SHA do head do branch (SPEC-015 — carimbo da asserção no momento da
   * captura). Só metadado de commit, nunca diff/conteúdo (ADR-010).
   */
  async getHeadSha(
    token: string,
    owner: string,
    repo: string,
    branch: string,
  ): Promise<string | null> {
    const url = new URL(`https://api.github.com/repos/${owner}/${repo}/commits`);
    url.searchParams.set('per_page', '1');
    url.searchParams.set('sha', branch);
    const res = await this.fetchGithub(token, url.toString());
    const commits = (await res.json()) as Array<{ sha?: string }>;
    return commits[0]?.sha ?? null;
  }

  /**
   * Deployments recentes do repo (SPEC-013). Só metadados GitHub-side, sem
   * conteúdo de código (ADR-003 adendo). Para cada deployment recente busca o
   * status mais recente e extrai o host do `environment_url` — a plataforma é
   * decidida no domínio puro (parse de sufixo). Degrada em silêncio quando o
   * App não tem a permissão `Deployments: read` (403/404) → `denied: true`.
   */
  async listDeploymentUrls(
    token: string,
    owner: string,
    repo: string,
    max = 10,
  ): Promise<{ environmentUrls: string[]; count: number; denied: boolean }> {
    const url = new URL(
      `https://api.github.com/repos/${owner}/${repo}/deployments`,
    );
    url.searchParams.set('per_page', String(max));
    const res = await this.fetchGithubOptional(token, url.toString());
    if (!res) return { environmentUrls: [], count: 0, denied: true };

    const deployments = (await res.json()) as Array<{ id: number }>;
    if (!deployments.length)
      return { environmentUrls: [], count: 0, denied: false };

    const urls = new Set<string>();
    for (const d of deployments) {
      const stRes = await this.fetchGithubOptional(
        token,
        `https://api.github.com/repos/${owner}/${repo}/deployments/${d.id}/statuses?per_page=1`,
      );
      if (!stRes) continue;
      const statuses = (await stRes.json()) as Array<{
        environment_url?: string;
      }>;
      const envUrl = statuses[0]?.environment_url;
      if (envUrl) urls.add(envUrl);
    }
    return { environmentUrls: [...urls], count: deployments.length, denied: false };
  }

  /**
   * Último workflow run do repo (SPEC-019 — Actions API). Só metadados
   * GitHub-side (conclusion + URL + data), sem conteúdo de código (ADR-003).
   * Degrada em silêncio sem a permissão `Actions: read` (403/404) → `denied`.
   * Repo sem Actions → `status: null` (o call site traduz para `sem-ci`).
   * `conclusion` é null enquanto o run não terminou (in_progress/queued).
   */
  async listLatestWorkflowRun(
    token: string,
    owner: string,
    repo: string,
  ): Promise<{
    status: string | null;
    conclusion: string | null;
    url: string | null;
    updatedAt: string | null;
    denied: boolean;
  }> {
    const url = new URL(
      `https://api.github.com/repos/${owner}/${repo}/actions/runs`,
    );
    url.searchParams.set('per_page', '1');
    const res = await this.fetchGithubOptional(token, url.toString());
    if (!res)
      return {
        status: null,
        conclusion: null,
        url: null,
        updatedAt: null,
        denied: true,
      };

    const body = (await res.json()) as {
      workflow_runs?: Array<{
        status?: string;
        conclusion?: string | null;
        html_url?: string;
        updated_at?: string;
      }>;
    };
    const run = body.workflow_runs?.[0];
    return {
      status: run?.status ?? null,
      conclusion: run?.conclusion ?? null,
      url: run?.html_url ?? null,
      updatedAt: run?.updated_at ?? null,
      denied: false,
    };
  }

  /**
   * SBOM do Dependency Graph (SPEC-023 / ADR-003 adendo). SPDX derivado dos
   * manifests pelo próprio GitHub — metadado sobre o código, nunca conteúdo.
   * Degrada em silêncio (`null`) quando o DG está desabilitado (o padrão em
   * repo privado), sem a permissão, ou o repo não tem manifests. O call site
   * traduz `null` no MESMO estado de fallback informativo — nunca erro mudo.
   */
  async getSbom(
    token: string,
    owner: string,
    repo: string,
  ): Promise<SbomResponse | null> {
    const res = await this.fetchGithubOptional(
      token,
      `https://api.github.com/repos/${owner}/${repo}/dependency-graph/sbom`,
    );
    if (!res) return null;
    return (await res.json()) as SbomResponse;
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

  /**
   * Variante tolerante para recursos que o App pode não ter permissão de ler
   * (SPEC-013 — `Deployments: read` pode faltar). 403 por falta de permissão ou
   * 404 → null (degrada). 403 por rate-limit segue o backoff normal. Nunca
   * derruba o sync.
   */
  private async fetchGithubOptional(
    token: string,
    url: string,
  ): Promise<Response | null> {
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      let res: Response;
      try {
        res = await fetch(url, {
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: 'application/vnd.github+json',
          },
          signal: AbortSignal.timeout(GITHUB_TIMEOUT_MS),
        });
      } catch {
        return null; // timeout/rede: degrada, não derruba o sync
      }

      const rateLimited =
        (res.status === 403 || res.status === 429) &&
        res.headers.get('x-ratelimit-remaining') === '0';

      if (rateLimited && attempt < MAX_RETRIES) {
        await sleep(rateLimitDelayMs(res.headers, attempt));
        continue;
      }
      if (res.status === 401 || res.status === 403 || res.status === 404) {
        return null; // sem permissão → degrada
      }
      if (!res.ok) return null;
      return res;
    }
    return null;
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
