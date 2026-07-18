import { Prisma } from '@prisma/client';
import { UsageService } from './usage.service';

const D = (v: string | number) => new Prisma.Decimal(v);

/** Prisma mock: soma injetável + contagem de priceMissing. */
function makePrisma(sumCostUsd: string | null, missing = 0, project: any = { userId: 'u1' }) {
  const client: any = {
    llmUsage: {
      aggregate: jest.fn().mockResolvedValue({ _sum: { costUsd: sumCostUsd === null ? null : D(sumCostUsd) } }),
      count: jest.fn().mockResolvedValue(missing),
    },
    project: { findUnique: jest.fn().mockResolvedValue(project) },
  };
  // withTenant (SPEC-022) roda a fn com o próprio client como tx transacional.
  client.withTenant = jest.fn((_ids: string[], fn: (tx: any) => any) => fn(client));
  return client;
}

function makeSettings(alert: string, hardCap: string) {
  return {
    capsOf: jest.fn().mockResolvedValue({ alert: D(alert), hardCap: D(hardCap) }),
    personalTenantId: jest.fn().mockResolvedValue('t-personal'),
  } as any;
}

const NOW = new Date('2026-07-14T12:00:00Z');

describe('UsageService — gate do teto (SPEC-009)', () => {
  it('gasto abaixo do teto → não bloqueia', async () => {
    const svc = new UsageService(makePrisma('12.5'), makeSettings('5', '20'));
    const r = await svc.currentMonth('u1', NOW);
    expect(r.blocked).toBe(false);
    expect(r.costUsd).toBe('12.5');
  });

  it('gasto >= teto → bloqueia', async () => {
    const svc = new UsageService(makePrisma('20'), makeSettings('5', '20'));
    const r = await svc.currentMonth('u1', NOW);
    expect(r.blocked).toBe(true);
  });

  it('teto 0 desliga o bloqueio, mesmo com gasto alto', async () => {
    const svc = new UsageService(makePrisma('999'), makeSettings('5', '0'));
    const r = await svc.currentMonth('u1', NOW);
    expect(r.blocked).toBe(false);
  });

  it('sem gasto no mês (soma null) → 0, não bloqueia', async () => {
    const svc = new UsageService(makePrisma(null), makeSettings('5', '20'));
    const r = await svc.currentMonth('u1', NOW);
    expect(r.costUsd).toBe('0');
    expect(r.blocked).toBe(false);
  });

  it('a soma do teto é GLOBAL — a query não filtra por provedor', async () => {
    const prisma = makePrisma('18');
    const svc = new UsageService(prisma, makeSettings('5', '20'));
    await svc.currentMonth('u1', NOW);
    // where só filtra por janela de mês, nunca por provider (soma todos juntos).
    const call = prisma.llmUsage.aggregate.mock.calls[0][0];
    expect(call.where.provider).toBeUndefined();
    expect(call.where.createdAt.gte).toEqual(new Date(Date.UTC(2026, 6, 1)));
    expect(call.where.createdAt.lt).toEqual(new Date(Date.UTC(2026, 7, 1)));
  });

  it('missingPriceCount é reportado (o teto protege menos do que promete)', async () => {
    const svc = new UsageService(makePrisma('4', 3), makeSettings('5', '20'));
    const r = await svc.currentMonth('u1', NOW);
    expect(r.missingPriceCount).toBe(3);
  });

  it('canSpend resolve o dono do projeto e checa o teto', async () => {
    const svc = new UsageService(makePrisma('25', 0, { userId: 'u1' }), makeSettings('5', '20'));
    expect(await svc.canSpend('p1', NOW)).toBe(false); // 25 >= 20 → bloqueado
  });

  it('canSpend de projeto inexistente → false (não gasta às cegas)', async () => {
    const svc = new UsageService(makePrisma('0', 0, null), makeSettings('5', '20'));
    expect(await svc.canSpend('nope', NOW)).toBe(false);
  });
});
