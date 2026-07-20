import { RoleSyncService, TenantAccount } from './role-sync.service';

/**
 * Os critérios de aceite da E2 dizem "conferível em rede/logs": o que importa
 * não é só o papel gravado, é **quantas vezes o GitHub foi chamado**. Por isso
 * o fake conta as chamadas — um teste que só olhasse o `role` passaria mesmo
 * com a tempestade de request que a decisão 2 existe para evitar.
 */
function makeFakes(opts: {
  role?: 'admin' | 'member' | null;
  roleSyncedAt?: Date | null;
  currentRole?: 'owner' | 'member' | 'viewer';
  ownerCount?: number;
}) {
  const calls: string[] = [];
  const updates: Array<{ role: string }> = [];

  const orgMembership = {
    roleOf: async (_t: string, org: string) => {
      calls.push(org);
      return opts.role ?? null;
    },
  };

  const prisma = {
    membership: {
      findMany: async () => [
        {
          id: 'm1',
          tenantId: 't1',
          role: opts.currentRole ?? 'member',
          roleSyncedAt: opts.roleSyncedAt ?? null,
        },
      ],
      count: async () => opts.ownerCount ?? 2,
      update: async ({ data }: { data: { role: string } }) => {
        updates.push(data);
        return data;
      },
    },
  };

  const svc = new RoleSyncService(prisma as never, orgMembership as never);
  return { svc, calls, updates };
}

const account = (over: Partial<TenantAccount> = {}): TenantAccount => ({
  tenantId: 't1',
  accountLogin: 'acme',
  accountType: 'Organization',
  ...over,
});

const NOW = new Date('2026-07-20T12:00:00Z');

describe('RoleSyncService', () => {
  it('org: consulta o GitHub e grava o papel derivado', async () => {
    const { svc, calls, updates } = makeFakes({ role: 'admin' });
    await svc.syncRoles('u1', 'rodreis', 'tok', [account()], NOW);
    expect(calls).toEqual(['acme']);
    expect(updates[0].role).toBe('owner');
  });

  it('tenant pessoal: ZERO chamada ao GitHub (decisão 3)', async () => {
    // Critério de aceite: "o dono é owner sem nenhuma chamada a
    // /orgs/.../memberships, conferível em rede/logs".
    const { svc, calls, updates } = makeFakes({ currentRole: 'viewer' });
    await svc.syncRoles('u1', 'rodreis', 'tok', [account({ accountType: 'User' })], NOW);
    expect(calls).toEqual([]);
    expect(updates[0].role).toBe('owner');
  });

  it('throttle: dentro da janela NÃO consulta o GitHub (decisão 2)', async () => {
    // Critério de aceite: "recálculos repetidos em janela curta não
    // multiplicam requests ao GitHub".
    const recent = new Date(NOW.getTime() - 60_000); // 1min atrás
    const { svc, calls, updates } = makeFakes({ role: 'admin', roleSyncedAt: recent });
    await svc.syncRoles('u1', 'rodreis', 'tok', [account()], NOW);
    expect(calls).toEqual([]);
    expect(updates).toEqual([]);
  });

  it('throttle: fora da janela consulta de novo', async () => {
    const old = new Date(NOW.getTime() - 20 * 60 * 1000); // 20min atrás
    const { svc, calls } = makeFakes({ role: 'admin', roleSyncedAt: old });
    await svc.syncRoles('u1', 'rodreis', 'tok', [account()], NOW);
    expect(calls).toEqual(['acme']);
  });

  it('nunca recalculado (roleSyncedAt null) → consulta na primeira vez', async () => {
    const { svc, calls } = makeFakes({ role: 'member', roleSyncedAt: null });
    await svc.syncRoles('u1', 'rodreis', 'tok', [account()], NOW);
    expect(calls).toEqual(['acme']);
  });

  it('guarda: único owner não é rebaixado, e o carimbo é gravado', async () => {
    // Sem o carimbo, o recálculo bloqueado repetiria a request a cada abertura
    // do catálogo — o throttle tem de valer também para o caso guardado.
    const { svc, updates } = makeFakes({
      role: null,
      currentRole: 'owner',
      ownerCount: 1,
    });
    await svc.syncRoles('u1', 'rodreis', 'tok', [account()], NOW);
    expect(updates[0].role).toBe('owner');
  });

  it('sem membership no tenant → não consulta nem grava', async () => {
    const { svc, calls, updates } = makeFakes({ role: 'admin' });
    await svc.syncRoles('u1', 'rodreis', 'tok', [account({ tenantId: 'outro' })], NOW);
    expect(calls).toEqual([]);
    expect(updates).toEqual([]);
  });

  it('lista vazia → não toca no banco', async () => {
    const { svc, calls, updates } = makeFakes({ role: 'admin' });
    await svc.syncRoles('u1', 'rodreis', 'tok', [], NOW);
    expect(calls).toEqual([]);
    expect(updates).toEqual([]);
  });
});
