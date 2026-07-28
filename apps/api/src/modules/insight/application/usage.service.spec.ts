import { Prisma } from '@prisma/client';
import { UsageService } from './usage.service';

const D = (v: string | number) => new Prisma.Decimal(v);

/** Prisma mock: soma injetável + contagem de priceMissing. */
function makePrisma(sumCostUsd: string | null, missing = 0, project: any = { tenantId: 't1' }) {
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

/**
 * `capsOf` só responde para o tenant esperado. Mock frouxo (que devolvesse o
 * mesmo teto para qualquer argumento) deixaria passar a regressão que o ADR-026
 * existe para impedir: resolver teto a partir de pessoa.
 */
function makeSettings(alert: string, hardCap: string, forTenant = 't1') {
  return {
    capsOf: jest.fn(async (tenantId: string) => {
      if (tenantId !== forTenant) {
        throw new Error(`capsOf recebeu "${tenantId}", esperava o tenant "${forTenant}"`);
      }
      return { alert: D(alert), hardCap: D(hardCap) };
    }),
    personalTenantId: jest.fn().mockResolvedValue('t1'),
  } as any;
}

const NOW = new Date('2026-07-14T12:00:00Z');

describe('UsageService — gate do teto (SPEC-009)', () => {
  it('gasto abaixo do teto → não bloqueia', async () => {
    const svc = new UsageService(makePrisma('12.5'), makeSettings('5', '20'));
    const r = await svc.currentMonth('t1', NOW);
    expect(r.blocked).toBe(false);
    expect(r.costUsd).toBe('12.5');
  });

  it('gasto >= teto → bloqueia', async () => {
    const svc = new UsageService(makePrisma('20'), makeSettings('5', '20'));
    const r = await svc.currentMonth('t1', NOW);
    expect(r.blocked).toBe(true);
  });

  it('teto 0 desliga o bloqueio, mesmo com gasto alto', async () => {
    const svc = new UsageService(makePrisma('999'), makeSettings('5', '0'));
    const r = await svc.currentMonth('t1', NOW);
    expect(r.blocked).toBe(false);
  });

  it('sem gasto no mês (soma null) → 0, não bloqueia', async () => {
    const svc = new UsageService(makePrisma(null), makeSettings('5', '20'));
    const r = await svc.currentMonth('t1', NOW);
    expect(r.costUsd).toBe('0');
    expect(r.blocked).toBe(false);
  });

  it('a soma do teto é GLOBAL — a query não filtra por provedor', async () => {
    const prisma = makePrisma('18');
    const svc = new UsageService(prisma, makeSettings('5', '20'));
    await svc.currentMonth('t1', NOW);
    // where só filtra por janela de mês, nunca por provider (soma todos juntos).
    const call = prisma.llmUsage.aggregate.mock.calls[0][0];
    expect(call.where.provider).toBeUndefined();
    expect(call.where.createdAt.gte).toEqual(new Date(Date.UTC(2026, 6, 1)));
    expect(call.where.createdAt.lt).toEqual(new Date(Date.UTC(2026, 7, 1)));
  });

  it('missingPriceCount é reportado (o teto protege menos do que promete)', async () => {
    const svc = new UsageService(makePrisma('4', 3), makeSettings('5', '20'));
    const r = await svc.currentMonth('t1', NOW);
    expect(r.missingPriceCount).toBe(3);
  });

  it('canSpend resolve o TENANT do projeto e checa o teto', async () => {
    const svc = new UsageService(makePrisma('25', 0, { tenantId: 't1' }), makeSettings('5', '20'));
    expect(await svc.canSpend('p1', NOW)).toBe(false); // 25 >= 20 → bloqueado
  });

  it('canSpend de projeto inexistente → false (não gasta às cegas)', async () => {
    const svc = new UsageService(makePrisma('0', 0, null), makeSettings('5', '20'));
    expect(await svc.canSpend('nope', NOW)).toBe(false);
  });
});

/**
 * ADR-026 — o teto é do tenant, não da pessoa. Estes casos travam o desenho:
 * o defeito que o ADR corrige passava com a suíte inteira verde, porque nada
 * afirmava DE QUEM era o teto.
 */
describe('UsageService — o teto é do tenant (ADR-026)', () => {
  it('canSpend lê o tenant do projeto, nunca o dono dele', async () => {
    const prisma = makePrisma('1', 0, { tenantId: 't1' });
    const svc = new UsageService(prisma, makeSettings('5', '20'));
    await svc.canSpend('p1', NOW);
    // A regressão a impedir: voltar a selecionar `userId` para resolver teto.
    expect(prisma.project.findUnique).toHaveBeenCalledWith({
      where: { id: 'p1' },
      select: { tenantId: true },
    });
  });

  it('projeto sem tenant → gate FECHA (não gastar por engano é mais barato)', async () => {
    const svc = new UsageService(makePrisma('0', 0, { tenantId: null }), makeSettings('5', '20'));
    expect(await svc.canSpend('p1', NOW)).toBe(false);
  });

  it('dois membros do mesmo tenant enxergam UM teto, não dois', async () => {
    // O defeito antigo: `Settings.userId` @unique dava um teto por pessoa sobre
    // a mesma soma, e o gate dependia de quem chamou. Agora a chave é o tenant,
    // então o veredito é idêntico para os dois membros.
    const settings = makeSettings('5', '20');
    const svcA = new UsageService(makePrisma('25'), settings);
    const svcB = new UsageService(makePrisma('25'), settings);
    expect(await svcA.canSpendForTenant('t1', NOW)).toBe(false);
    expect(await svcB.canSpendForTenant('t1', NOW)).toBe(false);
  });

  it('canSpendForTenant não precisa de usuário — é o caminho do job anônimo', async () => {
    const settings = makeSettings('5', '20');
    const svc = new UsageService(makePrisma('1'), settings);
    expect(await svc.canSpendForTenant('t1', NOW)).toBe(true);
    // O motivo de existir: o pipeline da SPEC-032 dispara de briefing público,
    // onde não há sessão para `personalTenantId` resolver.
    expect(settings.personalTenantId).not.toHaveBeenCalled();
  });

  it('canSpendForUser resolve o tenant e delega — não mede a pessoa', async () => {
    const settings = makeSettings('5', '20');
    const svc = new UsageService(makePrisma('25'), settings);
    expect(await svc.canSpendForUser('u1', NOW)).toBe(false);
    expect(settings.personalTenantId).toHaveBeenCalledWith('u1');
    expect(settings.capsOf).toHaveBeenCalledWith('t1');
  });
});
