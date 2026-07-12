import { Injectable, UnauthorizedException } from '@nestjs/common';

const TIMEOUT_MS = 10_000;

/** Erro de conflito de SHA no write-back (409/422 do PUT Contents). */
export class WritebackConflictError extends Error {
  constructor() {
    super('Conflito de SHA: o arquivo mudou no repositório desde a leitura.');
  }
}

/**
 * Escrita de arquivo no repo-alvo via GitHub Contents API (ADR-005).
 * Nasce aqui (insight); a Fatia 5 (Kanban) reusa promovendo para shared.
 */
@Injectable()
export class GithubWritebackClient {
  /** SHA atual do arquivo no branch, ou null se ainda não existe. */
  async getFileSha(
    token: string,
    owner: string,
    repo: string,
    path: string,
    branch: string,
  ): Promise<string | null> {
    const url = `https://api.github.com/repos/${owner}/${repo}/contents/${encodePath(path)}?ref=${encodeURIComponent(branch)}`;
    const res = await fetch(url, {
      headers: authHeaders(token),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (res.status === 404) return null;
    if (res.status === 401) throw new UnauthorizedException('Token GitHub inválido');
    if (!res.ok) throw new Error(`GitHub Contents GET ${res.status}`);
    const body = (await res.json()) as { sha: string };
    return body.sha;
  }

  /**
   * Cria/atualiza um arquivo com commit. `baseSha` = SHA lido antes de editar
   * (null para criação). Conflito → WritebackConflictError (caller re-sincroniza
   * e tenta 1x). Retorna o novo SHA do arquivo.
   */
  async putFile(params: {
    token: string;
    owner: string;
    repo: string;
    path: string;
    branch: string;
    content: string;
    message: string;
    baseSha: string | null;
  }): Promise<string> {
    const url = `https://api.github.com/repos/${params.owner}/${params.repo}/contents/${encodePath(params.path)}`;
    const res = await fetch(url, {
      method: 'PUT',
      headers: { ...authHeaders(params.token), 'content-type': 'application/json' },
      body: JSON.stringify({
        message: params.message,
        content: Buffer.from(params.content, 'utf-8').toString('base64'),
        branch: params.branch,
        ...(params.baseSha ? { sha: params.baseSha } : {}),
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (res.status === 401)
      throw new UnauthorizedException('Token GitHub inválido');
    if (res.status === 409 || res.status === 422) {
      throw new WritebackConflictError();
    }
    if (!res.ok) throw new Error(`GitHub Contents PUT ${res.status}: ${await res.text()}`);
    const body = (await res.json()) as { content: { sha: string } };
    return body.content.sha;
  }
}

function authHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
  };
}

/** Preserva as barras do path ao encodar (não escapar `/`). */
function encodePath(path: string): string {
  return path.split('/').map(encodeURIComponent).join('/');
}
