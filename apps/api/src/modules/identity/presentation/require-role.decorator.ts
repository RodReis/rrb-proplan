import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  SetMetadata,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Role } from '@prisma/client';
import type { AuthenticatedRequest } from './jwt-auth.guard';

export const REQUIRE_ROLE_KEY = 'requireRole';

/**
 * Papel MÍNIMO exigido na rota (SPEC-022). Hierarquia: owner > member > viewer.
 * `@RequireRole('member')` permite owner e member; `@RequireRole('owner')` só
 * owner (ex.: finalizar issue, ADR-011). Usar com TenantGuard, que popula role.
 */
export const RequireRole = (min: Role) => SetMetadata(REQUIRE_ROLE_KEY, min);

// Peso maior = mais privilégio. Papel do request deve pesar >= o exigido.
const RANK: Record<Role, number> = { viewer: 1, member: 2, owner: 3 };

@Injectable()
export class RoleGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const min = this.reflector.getAllAndOverride<Role | undefined>(
      REQUIRE_ROLE_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!min) return true; // rota sem exigência explícita

    const req = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (!req.role) throw new UnauthorizedException('papel não resolvido');
    if (RANK[req.role] < RANK[min]) {
      throw new ForbiddenException(`requer papel ${min}`);
    }
    return true;
  }
}
