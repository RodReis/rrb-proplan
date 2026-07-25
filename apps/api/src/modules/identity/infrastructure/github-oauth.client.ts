import { Injectable, UnauthorizedException } from '@nestjs/common';

export interface GithubUser {
  id: number;
  login: string;
  name: string | null;
  avatar_url: string;
}

/** Resultado da troca de code / refresh: user-to-server + refresh token. */
export interface UserTokenSet {
  accessToken: string;
  refreshToken: string;
  /** Instante de expiração do access token (user-to-server expira ~8h). */
  expiresAt: Date;
}

const TIMEOUT_MS = 10_000;

/**
 * OAuth **do GitHub App** (ADR-015). Usa o `client_id`/`client_secret` do App
 * (não do antigo OAuth App). As permissões vêm da instalação — não há `scope`
 * na URL de autorização. Retorna user-to-server + refresh token.
 */
@Injectable()
export class GithubOauthClient {
  authorizeUrl(state: string): string {
    const params = new URLSearchParams({
      client_id: process.env.GITHUB_APP_CLIENT_ID ?? '',
      redirect_uri: `${process.env.API_URL ?? 'http://localhost:3311'}/auth/github/callback`,
      state,
    });
    return `https://github.com/login/oauth/authorize?${params}`;
  }

  async exchangeCode(code: string): Promise<UserTokenSet> {
    return this.postToken({
      client_id: process.env.GITHUB_APP_CLIENT_ID,
      client_secret: process.env.GITHUB_APP_CLIENT_SECRET,
      code,
    });
  }

  async refresh(refreshToken: string): Promise<UserTokenSet> {
    return this.postToken({
      client_id: process.env.GITHUB_APP_CLIENT_ID,
      client_secret: process.env.GITHUB_APP_CLIENT_SECRET,
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    });
  }

  private async postToken(body: Record<string, string | undefined>): Promise<UserTokenSet> {
    const res = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const data = (await res.json()) as {
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
    };
    if (!data.access_token || !data.refresh_token) {
      throw new UnauthorizedException('GitHub não retornou tokens do App');
    }
    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt: new Date(Date.now() + (data.expires_in ?? 8 * 3600) * 1000),
    };
  }

  /**
   * Revoga a autorização do usuário no GitHub (SPEC-025).
   *
   * `DELETE /applications/{client_id}/grant` derruba **a concessão inteira** —
   * access e refresh token juntos. O irmão `/token` invalidaria só o access,
   * deixando o refresh vivo: quem "desconectou" continuaria renovável. Como a
   * spec exige revogação real ("seus dados continuam seus"), é o grant que cai.
   *
   * Autentica com Basic `client_id:client_secret` (é o App falando de si, não o
   * usuário) e devolve 204 sem corpo.
   */
  async revoke(accessToken: string): Promise<void> {
    const clientId = process.env.GITHUB_APP_CLIENT_ID;
    const clientSecret = process.env.GITHUB_APP_CLIENT_SECRET;
    if (!clientId || !clientSecret) {
      throw new UnauthorizedException('GitHub App sem client_id/client_secret');
    }
    const basic = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
    const res = await fetch(
      `https://api.github.com/applications/${clientId}/grant`,
      {
        method: 'DELETE',
        headers: {
          Authorization: `Basic ${basic}`,
          Accept: 'application/vnd.github+json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ access_token: accessToken }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      },
    );
    // 404 = concessão já não existe (token expirado, App desinstalado): o fim
    // desejado já vale, não é erro.
    if (!res.ok && res.status !== 404) {
      throw new UnauthorizedException('GitHub recusou revogar a autorização');
    }
  }

  async fetchUser(token: string): Promise<GithubUser> {
    const res = await fetch('https://api.github.com/user', {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) throw new UnauthorizedException('Token GitHub inválido');
    return (await res.json()) as GithubUser;
  }
}
