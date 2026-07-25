import { Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { CryptoService } from '../infrastructure/crypto.service';
import { GithubOauthClient } from '../infrastructure/github-oauth.client';
import {
  GithubInstallationsClient,
  Installation,
} from '../infrastructure/github-installations.client';
import { InstallationTokenService } from '../infrastructure/installation-token.service';

/** Renova se falta menos disto para expirar (evita 401 no meio da request). */
export const REFRESH_MARGIN_MS = 5 * 60 * 1000;

/** Decisão pura: o access token precisa ser renovado agora? */
export function needsRefresh(expiresAt: Date | null, now: Date): boolean {
  if (!expiresAt) return true;
  return expiresAt.getTime() - now.getTime() < REFRESH_MARGIN_MS;
}

/**
 * Serviço público de tokens do GitHub App (ADR-015). Os outros módulos pedem
 * o token **pelo nome da operação**, nunca escolhem qual token é qual:
 * - `userToken(userId)` → **toda leitura** (respeita a visibilidade do usuário).
 * - `installationToken(projectId)` → **toda escrita** (identidade `proplan[bot]`).
 *
 * Leitura com installation token é proibida — vazaria repos que o usuário
 * logado não enxerga.
 */
@Injectable()
export class GithubAuth {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly oauth: GithubOauthClient,
    private readonly installations: GithubInstallationsClient,
    private readonly installationTokens: InstallationTokenService,
  ) {}

  /**
   * Token user-to-server, renovado transparentemente se perto de expirar.
   *
   * O token vive na `Connection` (SPEC-025), não no `User`: uma conta pode
   * existir sem nenhuma conexão (nasceu do Google) ou ter acabado de
   * desconectar. Nos dois casos não há linha aqui — e a ausência é resposta
   * legítima, não corrupção: o catálogo lê isso como "conecte o GitHub".
   */
  async userToken(userId: string): Promise<string> {
    const connection = await this.prisma.connection.findUnique({
      where: { userId_provider: { userId, provider: 'github' } },
    });
    if (!connection) {
      throw new UnauthorizedException('GitHub não conectado — conecte para ler');
    }

    if (
      connection.encryptedUserToken &&
      !needsRefresh(connection.tokenExpiresAt, new Date())
    ) {
      return this.crypto.decrypt(connection.encryptedUserToken);
    }

    // Sem refresh token gravado (ex.: migração do OAuth App): refaz o login.
    if (!connection.encryptedRefreshToken) {
      throw new UnauthorizedException('Sessão expirada — refaça o login');
    }

    // Renovação transparente; falha derruba a sessão (SPEC-008).
    let refreshed;
    try {
      refreshed = await this.oauth.refresh(
        this.crypto.decrypt(connection.encryptedRefreshToken),
      );
    } catch {
      throw new UnauthorizedException('Sessão expirada — refaça o login');
    }
    await this.prisma.connection.update({
      where: { id: connection.id },
      data: {
        encryptedUserToken: this.crypto.encrypt(refreshed.accessToken),
        encryptedRefreshToken: this.crypto.encrypt(refreshed.refreshToken),
        tokenExpiresAt: refreshed.expiresAt,
      },
    });
    return refreshed.accessToken;
  }

  /** Token da instalação que gerencia o projeto (identidade de bot). */
  async installationToken(projectId: string): Promise<string> {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { installationId: true, installationStatus: true },
    });
    if (!project) throw new NotFoundException('Projeto não encontrado');
    if (!project.installationId || project.installationStatus !== 'active') {
      throw new UnauthorizedException(
        'Projeto sem instalação ativa do GitHub App — reinstale para escrever',
      );
    }
    return this.installationTokens.tokenFor(project.installationId);
  }

  /** Instalações do App visíveis para o usuário (leitura com token dele). */
  async installationsOf(userId: string): Promise<Installation[]> {
    const token = await this.userToken(userId);
    return this.installations.list(token);
  }
}
