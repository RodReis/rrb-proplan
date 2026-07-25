import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { randomBytes } from 'crypto';
import { PrismaService } from '../../../prisma/prisma.service';
import { CryptoService } from '../infrastructure/crypto.service';
import { GithubOauthClient } from '../infrastructure/github-oauth.client';
import { GoogleOauthClient } from '../infrastructure/google-oauth.client';

export interface SessionTenant {
  id: string;
  accountLogin: string;
  role: string; // owner | member | viewer
}

export interface SessionUser {
  id: string;
  login: string;
  name: string | null;
  avatarUrl: string | null;
  // Tenants de que o usuário é membro (SPEC-022). O front usa para o seletor de
  // tenant e para esconder controles por papel. Vazio = usuário sem tenant
  // (estado degradado — não deveria ocorrer após a migração do usuário único).
  tenants: SessionTenant[];
}

/**
 * Nome de exibição da conta Google (SPEC-026). O `login` do `SessionUser` nasceu
 * como o handle do GitHub; numa conta Google não existe handle, então usamos a
 * parte local do email. É rótulo de UI — nenhuma autorização depende dele (o
 * que manda é o `userId`), por isso não precisa ser único.
 */
export function loginFromEmail(email: string): string {
  const local = email.split('@')[0];
  return local || email;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly crypto: CryptoService,
    private readonly github: GithubOauthClient,
    private readonly google: GoogleOauthClient,
  ) {}

  /** state anti-CSRF: valor aleatório que vai no cookie e na URL do IdP. */
  createState(): string {
    return randomBytes(16).toString('hex');
  }

  loginUrl(state: string): string {
    return this.github.authorizeUrl(state);
  }

  /** URL de autorização do Google — a porta de entrada da sessão (SPEC-026). */
  googleLoginUrl(state: string): string {
    return this.google.authorizeUrl(state);
  }

  /**
   * Login por Google: cria a sessão do app a partir da identidade, não de
   * nenhuma conexão.
   *
   * Três casos, nesta ordem:
   * 1. `googleId` conhecido → é o mesmo usuário, atualiza o perfil.
   * 2. `googleId` novo mas o **email** já existe → é o usuário pré-existente
   *    (identidade-GitHub) migrando no primeiro login pós-deploy: carimba o
   *    `googleId` na conta que já tem os projetos, tenants e tokens. É este
   *    passo que cumpre o critério "sem perder projetos/tenant" da SPEC-026.
   * 3. Nenhum dos dois → conta nova, sem conexão GitHub. O catálogo é que vai
   *    pedir a conexão (fluxo de entrada da spec).
   *
   * O usuário antigo tem email? Sim quando a conta GitHub expõe email público;
   * quando não, o caso 2 não dispara e ele cai no caso 3 — vira conta nova e
   * reconecta o GitHub. Por isso a coluna `email` é preenchida no login: a
   * partir daqui todo usuário tem a chave de casamento.
   */
  async handleGoogleCallback(code: string): Promise<{ jwt: string }> {
    const accessToken = await this.google.exchangeCode(code);
    const profile = await this.google.fetchUser(accessToken);

    const perfil = {
      email: profile.email,
      name: profile.name,
      avatarUrl: profile.picture,
    };

    const existente = await this.prisma.user.findFirst({
      where: { OR: [{ googleId: profile.sub }, { email: profile.email }] },
    });

    const user = existente
      ? await this.prisma.user.update({
          where: { id: existente.id },
          data: {
            ...perfil,
            googleId: profile.sub,
            // `login` do usuário migrado é preservado: ele já é conhecido pelo
            // handle do GitHub, e trocá-lo mudaria o rótulo sem motivo.
            login: existente.login || loginFromEmail(profile.email),
          },
        })
      : await this.prisma.user.create({
          data: {
            ...perfil,
            googleId: profile.sub,
            login: loginFromEmail(profile.email),
          },
        });

    return { jwt: await this.jwt.signAsync({ sub: user.id }) };
  }

  async handleCallback(code: string): Promise<{ jwt: string }> {
    const tokens = await this.github.exchangeCode(code);
    const ghUser = await this.github.fetchUser(tokens.accessToken);

    const tokenFields = {
      encryptedUserToken: this.crypto.encrypt(tokens.accessToken),
      encryptedRefreshToken: this.crypto.encrypt(tokens.refreshToken),
      tokenExpiresAt: tokens.expiresAt,
    };

    const user = await this.prisma.user.upsert({
      where: { githubId: BigInt(ghUser.id) },
      create: {
        githubId: BigInt(ghUser.id),
        login: ghUser.login,
        name: ghUser.name,
        avatarUrl: ghUser.avatar_url,
        ...tokenFields,
      },
      update: {
        login: ghUser.login,
        name: ghUser.name,
        avatarUrl: ghUser.avatar_url,
        ...tokenFields,
      },
    });

    return { jwt: await this.jwt.signAsync({ sub: user.id }) };
  }

  async me(userId: string): Promise<SessionUser> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        memberships: { include: { tenant: true } },
      },
    });
    if (!user) throw new UnauthorizedException();
    return {
      id: user.id,
      login: user.login,
      name: user.name,
      avatarUrl: user.avatarUrl,
      tenants: user.memberships.map((m) => ({
        id: m.tenantId,
        accountLogin: m.tenant.accountLogin,
        role: m.role,
      })),
    };
  }
}
