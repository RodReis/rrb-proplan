import { ExecutionContext, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Role } from '@prisma/client';
import { RoleGuard, REQUIRE_ROLE_KEY } from './require-role.decorator';

function ctx(role: Role | undefined): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({ role }) }),
    getHandler: () => ({}),
    getClass: () => ({}),
  } as unknown as ExecutionContext;
}

function guardWith(min: Role | undefined): RoleGuard {
  const reflector = {
    getAllAndOverride: () => min,
  } as unknown as Reflector;
  return new RoleGuard(reflector);
}

describe('RoleGuard', () => {
  it('permite quando a rota não exige papel', () => {
    expect(guardWith(undefined).canActivate(ctx('viewer'))).toBe(true);
  });

  it('owner passa em rota que exige owner', () => {
    expect(guardWith('owner').canActivate(ctx('owner'))).toBe(true);
  });

  it('member é barrado em rota que exige owner (finalizar, ADR-011)', () => {
    expect(() => guardWith('owner').canActivate(ctx('member'))).toThrow(ForbiddenException);
  });

  it('member passa em rota que exige member', () => {
    expect(guardWith('member').canActivate(ctx('member'))).toBe(true);
  });

  it('owner passa em rota que exige member (hierarquia)', () => {
    expect(guardWith('member').canActivate(ctx('owner'))).toBe(true);
  });

  it('viewer é barrado em rota que exige member', () => {
    expect(() => guardWith('member').canActivate(ctx('viewer'))).toThrow(ForbiddenException);
  });

  it('papel ausente em rota com exigência → 401', () => {
    expect(() => guardWith('member').canActivate(ctx(undefined))).toThrow(UnauthorizedException);
  });

  it('a chave de metadata é estável', () => {
    expect(REQUIRE_ROLE_KEY).toBe('requireRole');
  });
});
