import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Role } from '@prisma/client';
import { TenantGuard } from './tenant.guard';
import type { MembershipService, CurrentMembership } from '../application/membership.service';

function ctx(userId: string, tenantParam: string | undefined): ExecutionContext {
  const req: { userId: string; params: Record<string, string>; tenantId?: string; role?: Role } = {
    userId,
    params: tenantParam ? { tenant: tenantParam } : {},
  };
  return {
    switchToHttp: () => ({ getRequest: () => req }),
    __req: req,
  } as unknown as ExecutionContext & { __req: typeof req };
}

function guardWith(membership: CurrentMembership | null): TenantGuard {
  const svc = {
    currentMembership: jest.fn().mockResolvedValue(membership),
  } as unknown as MembershipService;
  return new TenantGuard(svc);
}

describe('TenantGuard', () => {
  it('membro: popula tenantId e role, permite', async () => {
    const guard = guardWith({ tenantId: 't1', role: 'member' as Role });
    const c = ctx('u1', 't1') as ExecutionContext & { __req: { tenantId?: string; role?: Role } };
    await expect(guard.canActivate(c)).resolves.toBe(true);
    expect(c.__req.tenantId).toBe('t1');
    expect(c.__req.role).toBe('member');
  });

  it('não-membro: 403 (nunca vaza dado do tenant alheio)', async () => {
    const guard = guardWith(null);
    await expect(guard.canActivate(ctx('u1', 't-alheio'))).rejects.toThrow(ForbiddenException);
  });

  it('sem :tenant na rota: 403', async () => {
    const guard = guardWith({ tenantId: 't1', role: 'owner' as Role });
    await expect(guard.canActivate(ctx('u1', undefined))).rejects.toThrow(ForbiddenException);
  });
});
