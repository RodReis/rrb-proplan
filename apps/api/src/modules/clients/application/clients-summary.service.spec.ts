import { ClientsSummaryService } from './clients-summary.service';

const TENANT = 't1';

function prismaFake(over: Record<string, unknown> = {}): any {
  return {
    client: { count: jest.fn().mockResolvedValue(0) },
    clientProject: {
      groupBy: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
      findMany: jest.fn().mockResolvedValue([]),
    },
    clientStatusTransition: { findMany: jest.fn().mockResolvedValue([]) },
    ...over,
  };
}

/**
 * A superfície que o `dashboard` consome do `clients` (SPEC-035 §2.1, §6).
 *
 * Existe porque os métodos públicos do `ClientsService` são todos **por
 * projeto** (`getBoard`, `getProject`, `getHistory`) e o dashboard precisa de
 * contagem **por tenant**. A alternativa seria o agregador consultar
 * `client_projects` direto — exatamente o que o `dashboard.arch.spec.ts` quebra
 * o build para impedir (ADR-001).
 */
describe('ClientsSummaryService (SPEC-035)', () => {
  describe('funil por coluna', () => {
    it('devolve as 4 colunas SEMPRE, mesmo as vazias', async () => {
      // Coluna ausente da resposta faria a tela mostrar 2 colunas e a pessoa
      // concluir que as outras não existem — ausência ≠ zero (§2.7).
      const prisma = prismaFake();
      prisma.clientProject.groupBy.mockResolvedValue([
        { state: 'DRAFT', _count: { _all: 2 } },
      ]);

      const out = await new ClientsSummaryService(prisma).funnel(TENANT, new Date(0));

      expect(out.map((c) => c.column)).toEqual([
        'novo',
        'briefing',
        'prompt_contrato',
        'producao_entrega',
      ]);
      expect(out.find((c) => c.column === 'novo')?.count).toBe(2);
      expect(out.find((c) => c.column === 'briefing')?.count).toBe(0);
    });

    it('soma os estados que caem na MESMA coluna', async () => {
      // `ARTIFACTS_READY`, `CONTRACT_PENDING` e `CONTRACT_APPROVED` são três
      // estados de uma coluna só. O agrupamento é por estado no banco; a
      // projeção estado→coluna é regra de domínio e acontece aqui.
      const prisma = prismaFake();
      prisma.clientProject.groupBy.mockResolvedValue([
        { state: 'ARTIFACTS_READY', _count: { _all: 1 } },
        { state: 'CONTRACT_PENDING', _count: { _all: 3 } },
        { state: 'CONTRACT_APPROVED', _count: { _all: 2 } },
      ]);

      const out = await new ClientsSummaryService(prisma).funnel(TENANT, new Date(0));

      expect(out.find((c) => c.column === 'prompt_contrato')?.count).toBe(6);
    });

    it('filtra pelo tenant, pelo período e ignora projeto/cliente apagado', async () => {
      const prisma = prismaFake();
      const desde = new Date('2026-07-01T03:00:00.000Z');

      await new ClientsSummaryService(prisma).funnel(TENANT, desde);

      const where = prisma.clientProject.groupBy.mock.calls[0][0].where;
      expect(where.client).toEqual({ tenantId: TENANT, deletedAt: null });
      expect(where.deletedAt).toBeNull();
      expect(where.createdAt).toEqual({ gte: desde });
    });
  });

  describe('zero é resultado; ausência é outra coisa (§2.7, §5)', () => {
    it('tenant sem NENHUM cliente é `vazio`, não `zero`', async () => {
      const prisma = prismaFake();
      prisma.client.count.mockResolvedValue(0);

      expect(await new ClientsSummaryService(prisma).hasAnyClient(TENANT)).toBe(false);
    });

    it('tenant com cliente é `zero` mesmo que o período não tenha nada', async () => {
      // É a distinção que o `COUNT(*)` sozinho apaga: ele devolve 0 para "usei
      // e deu zero" e para "nunca usei", e colapsá-los faz o segundo parecer o
      // primeiro.
      const prisma = prismaFake();
      prisma.client.count.mockResolvedValue(1);

      expect(await new ClientsSummaryService(prisma).hasAnyClient(TENANT)).toBe(true);
    });
  });

  describe('cards parados (§2.3, item 4)', () => {
    it('usa o limite recebido, não um 7 literal', async () => {
      // O critério de aceite cobra isso por nome: "'parado' usa o limite
      // configurado, não `7` literal espalhado".
      const prisma = prismaFake();
      const agora = new Date('2026-08-15T15:00:00.000Z');

      await new ClientsSummaryService(prisma).stalledProjects(TENANT, 14, agora);

      const where = prisma.clientProject.findMany.mock.calls[0][0].where;
      // 14 dias antes de 15/08 15:00Z = 01/08 15:00Z.
      expect(where.updatedAt).toEqual({ lt: new Date('2026-08-01T15:00:00.000Z') });
    });

    it('não conta projeto arquivado nem entregue — parado ali é o fim normal', async () => {
      const prisma = prismaFake();

      await new ClientsSummaryService(prisma).stalledProjects(TENANT, 7, new Date());

      const where = prisma.clientProject.findMany.mock.calls[0][0].where;
      expect(where.state).toEqual({ notIn: ['DELIVERED', 'ARCHIVED'] });
    });

    it('devolve o card com título e cliente — a lista é clicável, não só um número', async () => {
      const prisma = prismaFake();
      prisma.clientProject.findMany.mockResolvedValue([
        {
          id: 'cp1',
          title: 'Loja nova',
          state: 'BRIEFING_STARTED',
          updatedAt: new Date('2026-07-01T00:00:00.000Z'),
          client: { id: 'c1', name: 'Ana', company: 'Acme' },
        },
      ]);

      const out = await new ClientsSummaryService(prisma).stalledProjects(
        TENANT,
        7,
        new Date(),
      );

      expect(out).toEqual([
        {
          clientProjectId: 'cp1',
          title: 'Loja nova',
          state: 'BRIEFING_STARTED',
          clientName: 'Ana',
          since: '2026-07-01T00:00:00.000Z',
        },
      ]);
    });
  });

  describe('trilha do funil para "O que andou por aqui" (§2.2, §7.1)', () => {
    it('lê as transições do tenant no período, mais recentes primeiro', async () => {
      const prisma = prismaFake();
      const desde = new Date('2026-08-01T03:00:00.000Z');

      await new ClientsSummaryService(prisma).recentTransitions(TENANT, desde, 20);

      const args = prisma.clientStatusTransition.findMany.mock.calls[0][0];
      expect(args.where.at).toEqual({ gte: desde });
      expect(args.where.clientProject).toEqual({
        deletedAt: null,
        client: { tenantId: TENANT, deletedAt: null },
      });
      expect(args.orderBy).toEqual({ at: 'desc' });
      expect(args.take).toBe(20);
    });

    it('traduz a transição em evento legível, sem inventar ator', async () => {
      // `actorUserId` é nullable de propósito (transição disparada pelo próprio
      // sistema). O bloco é rotulado por TENANT, não por usuário (§7.1) — então
      // o ator não entra na projeção e não há de onde inventar um.
      const prisma = prismaFake();
      prisma.clientStatusTransition.findMany.mockResolvedValue([
        {
          id: 'tr1',
          at: new Date('2026-08-10T12:00:00.000Z'),
          fromState: 'DRAFT',
          toState: 'LINK_SENT',
          clientProjectId: 'cp1',
          clientProject: { title: 'Loja nova', client: { name: 'Ana' } },
        },
      ]);

      const out = await new ClientsSummaryService(prisma).recentTransitions(
        TENANT,
        new Date(0),
        20,
      );

      expect(out).toEqual([
        {
          kind: 'funnel',
          at: '2026-08-10T12:00:00.000Z',
          clientProjectId: 'cp1',
          title: 'Loja nova',
          detail: 'DRAFT → LINK_SENT',
        },
      ]);
    });
  });
});
