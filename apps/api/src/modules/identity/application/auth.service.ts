import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { randomBytes } from 'crypto';
import { PrismaService } from '../../../prisma/prisma.service';
import { CryptoService } from '../infrastructure/crypto.service';
import { GithubOauthClient } from '../infrastructure/github-oauth.client';

export interface SessionUser {
  id: string;
  login: string;
  name: string | null;
  avatarUrl: string | null;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly crypto: CryptoService,
    private readonly github: GithubOauthClient,
  ) {}

  /** state anti-CSRF: valor aleatório que vai no cookie e na URL do GitHub. */
  createState(): string {
    return randomBytes(16).toString('hex');
  }

  loginUrl(state: string): string {
    return this.github.authorizeUrl(state);
  }

  async handleCallback(code: string): Promise<{ jwt: string }> {
    const token = await this.github.exchangeCode(code);
    const ghUser = await this.github.fetchUser(token);

    const user = await this.prisma.user.upsert({
      where: { githubId: BigInt(ghUser.id) },
      create: {
        githubId: BigInt(ghUser.id),
        login: ghUser.login,
        name: ghUser.name,
        avatarUrl: ghUser.avatar_url,
        encryptedGithubToken: this.crypto.encrypt(token),
      },
      update: {
        login: ghUser.login,
        name: ghUser.name,
        avatarUrl: ghUser.avatar_url,
        encryptedGithubToken: this.crypto.encrypt(token),
      },
    });

    return { jwt: await this.jwt.signAsync({ sub: user.id }) };
  }

  async me(userId: string): Promise<SessionUser> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new UnauthorizedException();
    return {
      id: user.id,
      login: user.login,
      name: user.name,
      avatarUrl: user.avatarUrl,
    };
  }

  /** Interface pública do módulo: token GitHub decriptado para outros módulos. */
  async githubTokenOf(userId: string): Promise<string> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new UnauthorizedException();
    return this.crypto.decrypt(user.encryptedGithubToken);
  }
}
