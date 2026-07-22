import { MembershipService } from './membership.service';

/**
 * Criação de Tenant+Membership no primeiro acesso (SPEC-022 decisões 1 e 3).
 *
 * O bug que estes testes travam: `Tenant`/`Membership` só nasciam do backfill
 * da migration da Fatia 8. Num banco novo — o primeiro deploy em produção — não
 * havia o que converter, então o usuário logava sem tenant, `app.tenant_ids`
 * ficava vazio e o RLS barrava toda escrita com 42501. A própria SPEC-022
 * registra o furo na emenda E2: *"nada no código cria Tenant/Membership"*.
 */
type CreatedTenant = {
  installationId: number;
  accountId: number;
  accountLogin: string;
  accountType: string;
  role: string;
  userId: string;
};

function makeFakes(existing: {
  id: string;
  installationId: number | null;
  accountId: number | null;
}[] = []) {
  const created: CreatedTenant[] = [];
  const upserted: { userId: string; tenantId: string; role: string }[] = [];

  const prisma = {
    tenant: {
      findMany: async () => existing,
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const m = data.memberships as { create: { userId: string; role: string } };
        created.push({
          installationId: data.installationId as number,
          accountId: data.accountId as number,
          accountLogin: data.accountLogin as string,
          accountType: data.accountType as string,
          role: m.create.role,
          userId: m.create.userId,
        });
        return { id: 'novo-' + data.installationId };
      },
    },
    membership: {
      upsert: async ({
        where,
        create,
      }: {
        where: { userId_tenantId: { userId: string; tenantId: string } };
        create: { role: string };
      }) => {
        upserted.push({
          userId: where.userId_tenantId.userId,
          tenantId: where.userId_tenantId.tenantId,
          role: create.role,
        });
        return {};
      },
    },
  };

  return { prisma, created, upserted };
}

const inst = (over: Partial<{ id: number; accountId: number; login: string; type: string }> = {}) => ({
  id: over.id ?? 100,
  account: {
    id: over.accountId ?? 900,
    login: over.login ?? 'rodreis',
    type: over.type ?? 'User',
  },
});

describe('MembershipService.ensureTenants', () => {
  it('instalação sem tenant → cria tenant e membership', async () => {
    const { prisma, created } = makeFakes();
    const svc = new MembershipService(prisma as never);

    await svc.ensureTenants('u1', [inst()]);

    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({
      installationId: 100,
      accountId: 900,
      accountLogin: 'rodreis',
      accountType: 'User',
      userId: 'u1',
    });
  });

  // Decisão 3 da E2: o carve-out de conta pessoal é explícito — "o dono da conta
  // é sempre owner, por definição, ZERO lookup de papel no GitHub".
  it('conta pessoal (User) nasce owner', async () => {
    const { prisma, created } = makeFakes();
    await new MembershipService(prisma as never).ensureTenants('u1', [
      inst({ type: 'User' }),
    ]);
    expect(created[0].role).toBe('owner');
  });

  // Numa org o papel DERIVA do GitHub (decisão 1) — quem cria não decide. Nascer
  // `member` é o piso seguro: o RoleSyncService promove a owner no mesmo request
  // se a pessoa for admin da org. O contrário daria privilégio indevido.
  it('organização nasce member, nunca owner', async () => {
    const { prisma, created } = makeFakes();
    await new MembershipService(prisma as never).ensureTenants('u1', [
      inst({ type: 'Organization', login: 'acme' }),
    ]);
    expect(created[0].role).toBe('member');
  });

  it('instalação que já tem tenant não cria nada (idempotente)', async () => {
    const { prisma, created } = makeFakes([
      { id: 't1', installationId: 100, accountId: 900 },
    ]);
    await new MembershipService(prisma as never).ensureTenants('u1', [inst()]);
    expect(created).toHaveLength(0);
  });

  // Reinstall emite um installationId NOVO. O re-link roda antes e reconcilia,
  // mas se ainda não tiver rodado o casamento por conta impede o tenant
  // duplicado que orfanaria todos os dados do antigo (SPEC-022 §Notas técnicas).
  it('reinstall (id novo, mesma conta) NÃO duplica o tenant', async () => {
    const { prisma, created } = makeFakes([
      { id: 't1', installationId: 55, accountId: 900 },
    ]);
    await new MembershipService(prisma as never).ensureTenants('u1', [
      inst({ id: 777, accountId: 900 }),
    ]);
    expect(created).toHaveLength(0);
  });

  it('usuário novo em tenant que já existe ganha membership member', async () => {
    const { prisma, created, upserted } = makeFakes([
      { id: 't1', installationId: 100, accountId: 900 },
    ]);
    await new MembershipService(prisma as never).ensureTenants('u2', [inst()]);

    expect(created).toHaveLength(0);
    expect(upserted).toEqual([{ userId: 'u2', tenantId: 't1', role: 'member' }]);
  });

  // Fail-closed: só entra membership de tenant cuja instalação/conta ESTE
  // usuário enxerga. Um tenant alheio que vazasse na consulta não pode virar
  // acesso.
  it('tenant que não bate com nenhuma instalação visível não vira membership', async () => {
    const { prisma, upserted } = makeFakes([
      { id: 'alheio', installationId: 4242, accountId: 4242 },
    ]);
    await new MembershipService(prisma as never).ensureTenants('u1', [inst()]);
    expect(upserted).toEqual([]);
  });

  it('sem instalações não toca no banco', async () => {
    const { prisma, created, upserted } = makeFakes();
    await new MembershipService(prisma as never).ensureTenants('u1', []);
    expect(created).toEqual([]);
    expect(upserted).toEqual([]);
  });

  it('várias instalações → um tenant por conta', async () => {
    const { prisma, created } = makeFakes();
    await new MembershipService(prisma as never).ensureTenants('u1', [
      inst({ id: 1, accountId: 10, login: 'pessoal', type: 'User' }),
      inst({ id: 2, accountId: 20, login: 'acme', type: 'Organization' }),
    ]);
    expect(created.map((c) => [c.accountLogin, c.role])).toEqual([
      ['pessoal', 'owner'],
      ['acme', 'member'],
    ]);
  });
});
