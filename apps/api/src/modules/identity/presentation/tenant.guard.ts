import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { MembershipService } from '../application/membership.service';
import type { AuthenticatedRequest } from './jwt-auth.guard';

/**
 * Resolve o tenant ativo do path (/t/:tenant/…) e o papel do usuário nele
 * (SPEC-022). Encadeia APÓS o JwtAuthGuard (precisa de req.userId).
 *
 * Não-membro → 403 (nunca 404 vazando existência, nem dado do tenant alheio).
 * Esta é a barreira PRIMÁRIA de isolamento na aplicação; o RLS é a rede que
 * corta a query que porventura escape do escopo.
 */
@Injectable()
export class TenantGuard implements CanActivate {
  constructor(private readonly memberships: MembershipService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const tenantId = req.params?.['tenant'];
    if (!tenantId) throw new ForbiddenException('tenant ausente na rota');

    const membership = await this.memberships.currentMembership(
      req.userId,
      tenantId,
    );
    if (!membership) throw new ForbiddenException('não é membro deste tenant');

    req.tenantId = membership.tenantId;
    req.role = membership.role;
    return true;
  }
}
