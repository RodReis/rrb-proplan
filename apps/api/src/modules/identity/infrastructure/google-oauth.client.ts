import {
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';

/** Perfil OpenID do Google. `sub` é o id estável da conta (sobrevive à troca
 *  de email); `email_verified` é o que autoriza usar o email como chave. */
export interface GoogleUser {
  sub: string;
  email: string;
  email_verified: boolean;
  name: string | null;
  picture: string | null;
}

const TIMEOUT_MS = 10_000;

/**
 * OAuth do Google — o **IdP da identidade** (SPEC-026). Não confundir com o
 * `GithubOauthClient`: aquele autoriza a leitura de repositórios (conexão);
 * este responde *quem é o usuário*. Perder a conexão GitHub não afeta a sessão,
 * porque a sessão deriva daqui.
 *
 * Escopos mínimos: `openid email profile` — o ProPlan não pede acesso a nada
 * do Google além de identificar a pessoa que dá o aceite.
 */
@Injectable()
export class GoogleOauthClient {
  private redirectUri(): string {
    return `${process.env.API_URL ?? 'http://localhost:3311'}/auth/google/callback`;
  }

  /**
   * Credencial obrigatória, com erro no servidor em vez de string vazia.
   *
   * Com `?? ''` a API montava a URL do Google com `client_id=` vazio e mandava
   * o usuário para lá assim mesmo — que respondia `Erro 400: invalid_request`,
   * uma tela do Google que não diz o que fazer e parece problema de conta.
   * Aconteceu no primeiro login em produção (a variável só existia no dev).
   * Config ausente é defeito de deploy: falha aqui, nomeando a variável.
   */
  private required(name: 'GOOGLE_CLIENT_ID' | 'GOOGLE_CLIENT_SECRET'): string {
    const value = process.env[name];
    if (!value) {
      throw new ServiceUnavailableException(
        `Login com Google indisponível: ${name} não configurada no ambiente`,
      );
    }
    return value;
  }

  authorizeUrl(state: string): string {
    const params = new URLSearchParams({
      client_id: this.required('GOOGLE_CLIENT_ID'),
      redirect_uri: this.redirectUri(),
      response_type: 'code',
      scope: 'openid email profile',
      state,
    });
    return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
  }

  /** Troca o code pelo access token. O ProPlan não guarda token do Google: ele
   *  serve só para ler o perfil uma vez e montar a sessão. */
  async exchangeCode(code: string): Promise<string> {
    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: this.required('GOOGLE_CLIENT_ID'),
        client_secret: this.required('GOOGLE_CLIENT_SECRET'),
        code,
        grant_type: 'authorization_code',
        redirect_uri: this.redirectUri(),
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const data = (await res.json()) as { access_token?: string };
    if (!data.access_token) {
      throw new UnauthorizedException('Google não retornou token');
    }
    return data.access_token;
  }

  async fetchUser(accessToken: string): Promise<GoogleUser> {
    const res = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) throw new UnauthorizedException('Token Google inválido');
    const user = (await res.json()) as GoogleUser;
    // Email não verificado não pode casar com usuário pré-existente: qualquer
    // um criaria uma conta Google com o email de outro e herdaria os projetos.
    if (!user.email_verified) {
      throw new UnauthorizedException('Email do Google não verificado');
    }
    return user;
  }
}
