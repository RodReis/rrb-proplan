import { Injectable, UnauthorizedException } from '@nestjs/common';

const TIMEOUT_MS = 10_000;

export interface InstallationAccount {
  login: string;
  type: 'User' | 'Organization';
}

export interface Installation {
  id: number;
  account: InstallationAccount;
}

/**
 * Lista as instalações do GitHub App visíveis para o usuário logado,
 * sempre com o **token do usuário** (ADR-015: leitura nunca com installation).
 * `GET /user/installations`.
 */
@Injectable()
export class GithubInstallationsClient {
  async list(userToken: string): Promise<Installation[]> {
    const res = await fetch(
      'https://api.github.com/user/installations?per_page=100',
      {
        headers: authHeaders(userToken),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      },
    );
    if (res.status === 401) throw new UnauthorizedException('Token GitHub inválido');
    if (!res.ok) throw new Error(`GitHub /user/installations ${res.status}`);
    const body = (await res.json()) as { installations: Installation[] };
    return body.installations ?? [];
  }
}

function authHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
  };
}
