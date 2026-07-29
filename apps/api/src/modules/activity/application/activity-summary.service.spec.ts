import { ActivitySummaryService } from './activity-summary.service';

const TENANT = 't1';

function prismaFake(): any {
  return {
    auditEvent: { findMany: jest.fn().mockResolvedValue([]) },
    syncRun: { findMany: jest.fn().mockResolvedValue([]) },
  };
}

describe('ActivitySummaryService (SPEC-035 §2.2, §7.1)', () => {
  describe('auditoria', () => {
    it('filtra por tenant e período, mais recentes primeiro', async () => {
      const prisma = prismaFake();
      const desde = new Date('2026-08-01T03:00:00.000Z');

      await new ActivitySummaryService(prisma).recentAudit(TENANT, desde, 20);

      const args = prisma.auditEvent.findMany.mock.calls[0][0];
      expect(args.where).toEqual({ tenantId: TENANT, at: { gte: desde } });
      expect(args.orderBy).toEqual({ at: 'desc' });
      expect(args.take).toBe(20);
    });

    it('não projeta ator — a tabela não tem coluna de ator (§7.1)', async () => {
      // O bloco é rotulado por TENANT justamente porque `AuditEvent` não tem
      // `actor_user_id`. Se algum dia o `select` pedisse um campo de ator, este
      // teste falharia antes de a tela prometer um filtro que não existe.
      const prisma = prismaFake();
      prisma.auditEvent.findMany.mockResolvedValue([
        {
          kind: 'client.created',
          subject: 'c1',
          at: new Date('2026-08-10T12:00:00.000Z'),
        },
      ]);

      const out = await new ActivitySummaryService(prisma).recentAudit(
        TENANT,
        new Date(0),
        20,
      );

      expect(out).toEqual([
        {
          kind: 'audit',
          at: '2026-08-10T12:00:00.000Z',
          detail: 'client.created: c1',
          projectId: null,
        },
      ]);
      expect(prisma.auditEvent.findMany.mock.calls[0][0].select).toEqual({
        kind: true,
        subject: true,
        at: true,
      });
    });
  });

  describe('syncs', () => {
    it('`noop` fica de fora — sync que não mudou nada não é notícia', async () => {
      // Incluí-los encheria a retomada de "nada mudou", que é o oposto de
      // responder "o que andou por aqui". Mesmo padrão do feed do painel.
      const prisma = prismaFake();

      await new ActivitySummaryService(prisma).recentSyncs(TENANT, new Date(0), 20);

      const where = prisma.syncRun.findMany.mock.calls[0][0].where;
      expect(where.status).toEqual({ not: 'noop' });
      expect(where.project).toEqual({ tenantId: TENANT });
    });

    it('resume o que mudou no repo, com o nome dele', async () => {
      const prisma = prismaFake();
      prisma.syncRun.findMany.mockResolvedValue([
        {
          id: 's1',
          projectId: 'p1',
          status: 'success',
          added: 2,
          updated: 1,
          removed: 0,
          startedAt: new Date('2026-08-11T08:00:00.000Z'),
          project: { owner: 'RodReis', name: 'rrb-proplan' },
        },
      ]);

      const out = await new ActivitySummaryService(prisma).recentSyncs(
        TENANT,
        new Date(0),
        20,
      );

      expect(out).toEqual([
        {
          kind: 'sync',
          at: '2026-08-11T08:00:00.000Z',
          detail: 'RodReis/rrb-proplan: +2 ~1 -0',
          projectId: 'p1',
        },
      ]);
    });
  });
});
