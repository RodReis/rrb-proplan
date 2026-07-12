import { Injectable, UnauthorizedException } from '@nestjs/common';

export interface GithubUser {
  id: number;
  login: string;
  name: string | null;
  avatar_url: string;
}

@Injectable()
export class GithubOauthClient {
  authorizeUrl(state: string): string {
    const params = new URLSearchParams({
      client_id: process.env.GITHUB_CLIENT_ID ?? '',
      redirect_uri: 'http://localhost:3000/auth/github/callback',
      scope: 'repo read:user',
      state,
    });
    return `https://github.com/login/oauth/authorize?${params}`;
  }

  async exchangeCode(code: string): Promise<string> {
    const res = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        client_id: process.env.GITHUB_CLIENT_ID,
        client_secret: process.env.GITHUB_CLIENT_SECRET,
        code,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    const body = (await res.json()) as { access_token?: string };
    if (!body.access_token) {
      throw new UnauthorizedException('GitHub não retornou access_token');
    }
    return body.access_token;
  }

  async fetchUser(token: string): Promise<GithubUser> {
    const res = await fetch('https://api.github.com/user', {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new UnauthorizedException('Token GitHub inválido');
    return (await res.json()) as GithubUser;
  }
}
