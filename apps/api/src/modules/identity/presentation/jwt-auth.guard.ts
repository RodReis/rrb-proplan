import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Request } from 'express';

import type { Role } from '@prisma/client';
import { resolveDevAuthBypass } from '../domain/dev-auth-bypass';

export interface AuthenticatedRequest extends Request {
  userId: string;
  // Populados pelo TenantGuard (SPEC-022) nas rotas /t/:tenant. Ausentes nas
  // rotas globais (auth, catalog) que não resolvem tenant.
  tenantId?: string;
  role?: Role;
}

@Injectable()
export class JwtAuthGuard implements CanActivate {
  private readonly logger = new Logger(JwtAuthGuard.name);
  /**
   * Resolvido UMA VEZ, na construção do guard.
   *
   * Ler `process.env` a cada request deixaria o estado da autenticação
   * mutável em runtime — quem mexesse no ambiente do processo mudaria quem
   * entra, sem reiniciar nada. Congelar no boot faz o bypass ser uma decisão
   * de inicialização, visível no log, e não um alvo móvel.
   */
  private readonly bypass = resolveDevAuthBypass(process.env);

  constructor(private readonly jwt: JwtService) {
    if (this.bypass.enabled) {
      // Barulhento de propósito: um servidor sem autenticação não pode subir
      // em silêncio. Se este aviso aparecer em produção, é incidente.
      this.logger.warn(
        `AUTENTICAÇÃO DESLIGADA (DEV_AUTH_BYPASS): toda requisição entra como ${this.bypass.userId}. ` +
          'Isto NUNCA liga com NODE_ENV=production.',
      );
    }
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<AuthenticatedRequest>();

    // Bypass de DEV (decisão do PI, 2026-07-27): o consent screen do Google
    // está em modo Testing e recusa quem não está na lista de usuários de
    // teste, o que trava o dev local por configuração fora do repositório.
    //
    // Assume um usuário REAL do banco local (o do seed), não um sintético: as
    // rotas `/t/:tenant` precisam de alguém com membership, e um usuário
    // inventado quebraria ali de um jeito confuso.
    //
    // A regra que decide isto exige NODE_ENV ≠ production no AND — ver
    // `dev-auth-bypass.ts`. Produção recusa mesmo com a flag ligada por engano.
    if (this.bypass.enabled) {
      req.userId = this.bypass.userId!;
      return true;
    }

    const token = req.cookies?.['proplan_session'];
    if (!token) throw new UnauthorizedException();
    try {
      const payload = await this.jwt.verifyAsync<{ sub: string }>(token);
      req.userId = payload.sub;
      return true;
    } catch {
      throw new UnauthorizedException();
    }
  }
}
