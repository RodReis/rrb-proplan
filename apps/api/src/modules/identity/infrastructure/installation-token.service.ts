import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { signAppJwt } from './github-app-jwt';
import { REDIS_CLIENT } from './redis.provider';

const TIMEOUT_MS = 10_000;
/** Token vale 1h; cacheia por 55min para renovar antes de expirar (SPEC-008). */
export const INSTALLATION_TOKEN_TTL_S = 55 * 60;

export const installationCacheKey = (installationId: number): string =>
  `installation_token:${installationId}`;

/**
 * Emite e cacheia installation tokens do GitHub App (identidade `proplan[bot]`).
 * Cache **por instalação** em Redis (não por projeto — projetos da mesma conta
 * compartilham o token, ADR-015). Usado só por caminhos de escrita.
 */
@Injectable()
export class InstallationTokenService {
  private readonly logger = new Logger(InstallationTokenService.name);

  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  /** Token da instalação, do cache ou emitido sob demanda. */
  async tokenFor(installationId: number): Promise<string> {
    const key = installationCacheKey(installationId);
    const cached = await this.redis.get(key);
    if (cached) return cached;

    const token = await this.mint(installationId);
    await this.redis.set(key, token, 'EX', INSTALLATION_TOKEN_TTL_S);
    return token;
  }

  private appId(): string {
    const id = process.env.GITHUB_APP_ID;
    if (!id) throw new Error('GITHUB_APP_ID não configurado');
    return id;
  }

  private privateKeyBase64(): string {
    const key = process.env.GITHUB_APP_PRIVATE_KEY;
    if (!key) throw new Error('GITHUB_APP_PRIVATE_KEY não configurado');
    return key;
  }

  /** JWT do App → POST access_tokens. Não cacheado aqui (o caller cacheia). */
  private async mint(installationId: number): Promise<string> {
    const nowSeconds = Math.floor(Date.now() / 1000);
    const appJwt = signAppJwt(this.appId(), this.privateKeyBase64(), nowSeconds);
    const res = await fetch(
      `https://api.github.com/app/installations/${installationId}/access_tokens`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${appJwt}`,
          Accept: 'application/vnd.github+json',
        },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      },
    );
    if (!res.ok) {
      const body = await res.text();
      this.logger.error(
        `access_tokens falhou (${res.status}) para instalação ${installationId}: ${body}`,
      );
      throw new Error(`GitHub access_tokens ${res.status}`);
    }
    const body = (await res.json()) as { token: string };
    return body.token;
  }
}
