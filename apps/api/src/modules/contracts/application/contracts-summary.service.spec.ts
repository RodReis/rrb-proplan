import { ContractsSummaryService } from './contracts-summary.service';

const TENANT = 't1';

function prismaFake(): any {
  return {
    contract: {
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
    },
  };
}

describe('ContractsSummaryService (SPEC-035)', () => {
  describe('contratos sem aceite (§2.3, item 3)', () => {
    it('filtra por `acceptedAt: null` no tenant', async () => {
      const prisma = prismaFake();

      await new ContractsSummaryService(prisma).unaccepted(TENANT);

      const where = prisma.contract.findMany.mock.calls[0][0].where;
      expect(where.tenantId).toBe(TENANT);
      expect(where.acceptedAt).toBeNull();
    });

    it('devolve versão e projeto — refazer emite v2, e a tela precisa dizer qual', async () => {
      const prisma = prismaFake();
      prisma.contract.findMany.mockResolvedValue([
        {
          id: 'ct1',
          clientProjectId: 'cp1',
          version: 2,
          createdAt: new Date('2026-08-02T09:00:00.000Z'),
          clientProject: { title: 'Loja nova' },
        },
      ]);

      const out = await new ContractsSummaryService(prisma).unaccepted(TENANT);

      expect(out).toEqual([
        {
          contractId: 'ct1',
          clientProjectId: 'cp1',
          title: 'Loja nova',
          version: 2,
          since: '2026-08-02T09:00:00.000Z',
        },
      ]);
    });
  });

  describe('zero é resultado; ausência é outra coisa (§2.7, §5)', () => {
    it('tenant que emitiu e teve zero NO PERÍODO: issued 0, hasAny true', async () => {
      const prisma = prismaFake();
      // issued, accepted, total — nesta ordem no Promise.all.
      prisma.contract.count
        .mockResolvedValueOnce(0)
        .mockResolvedValueOnce(0)
        .mockResolvedValueOnce(3);

      const out = await new ContractsSummaryService(prisma).counts(TENANT, new Date(0));

      expect(out).toEqual({ issued: 0, accepted: 0, hasAny: true });
    });

    it('tenant que nunca emitiu: issued 0, hasAny FALSE — a tela diz outra coisa', async () => {
      const prisma = prismaFake();
      prisma.contract.count.mockResolvedValue(0);

      const out = await new ContractsSummaryService(prisma).counts(TENANT, new Date(0));

      expect(out).toEqual({ issued: 0, accepted: 0, hasAny: false });
    });

    it('`hasAny` ignora o período de propósito — a pergunta é "já usou alguma vez"', async () => {
      const prisma = prismaFake();
      const desde = new Date('2026-08-01T03:00:00.000Z');

      await new ContractsSummaryService(prisma).counts(TENANT, desde);

      const [emitidos, aceitos, total] = prisma.contract.count.mock.calls.map(
        (c: any) => c[0].where,
      );
      expect(emitidos.createdAt).toEqual({ gte: desde });
      expect(aceitos.createdAt).toEqual({ gte: desde });
      expect(aceitos.acceptedAt).toEqual({ not: null });
      expect(total.createdAt).toBeUndefined();
    });
  });
});
