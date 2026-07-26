import { NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { transactionMock } from '../../../../test/prisma-transaction-mock';
import { ClientsService } from './clients.service';

const TENANT = 't1';

/**
 * Fake do Prisma com o mínimo que o service toca. `any` explícito porque o
 * `$transaction` referencia o próprio fake (mesmo motivo do board.service.spec).
 */
function prismaFake(over: Record<string, unknown> = {}): any {
  const prisma: any = {
    client: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn(),
      update: jest.fn(),
    },
    clientProject: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn(),
      update: jest.fn(),
    },
    clientStatusTransition: {
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn(),
    },
    auditEvent: { create: jest.fn().mockResolvedValue({}) },
    // Suporta as duas formas do Prisma. O service usa a INTERATIVA (issue #113);
    // um mock que só entendesse lote deixaria passar um call site que quebra em
    // produção — que foi como o bug original sobreviveu.
    $transaction: transactionMock(() => prisma),
    ...over,
  };
  return prisma;
}

describe('ClientsService (SPEC-029)', () => {
  describe('transição de funil', () => {
    it('grava estado novo e trilha na MESMA transação', async () => {
      const project = { id: 'cp1', state: 'DRAFT', client: { id: 'c1' } };
      const prisma = prismaFake();
      prisma.clientProject.findFirst.mockResolvedValue(project);
      prisma.clientProject.update.mockResolvedValue({ ...project, state: 'LINK_SENT' });
      prisma.clientStatusTransition.create.mockResolvedValue({});

      const svc = new ClientsService(prisma);
      const out = await svc.transition(TENANT, 'cp1', { to: 'LINK_SENT' }, 'u1');

      expect(out).toMatchObject({ state: 'LINK_SENT' });
      // O update e o create da trilha entram JUNTOS no $transaction — card que
      // muda de estado sem linha de auditoria é o histórico furado que esta
      // frente promete não ter.
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      // E na forma INTERATIVA (callback), não em lote: sob contexto de tenant o
      // lote sairia em duas conexões, sem a atomicidade que aparenta prometer
      // (issue #113 e `batch-transaction.arch.spec.ts`).
      expect(typeof prisma.$transaction.mock.calls[0][0]).toBe('function');
      expect(prisma.clientProject.update).toHaveBeenCalledWith({
        where: { id: 'cp1' },
        data: { state: 'LINK_SENT' },
      });
      expect(prisma.clientStatusTransition.create).toHaveBeenCalledWith({
        data: {
          clientProjectId: 'cp1',
          fromState: 'DRAFT',
          toState: 'LINK_SENT',
          actorUserId: 'u1',
        },
      });
    });

    it('transição inválida → 422 e NADA é gravado (rollback na UI)', async () => {
      const prisma = prismaFake();
      prisma.clientProject.findFirst.mockResolvedValue({
        id: 'cp1',
        state: 'DRAFT',
        client: { id: 'c1' },
      });

      const svc = new ClientsService(prisma);
      await expect(
        svc.transition(TENANT, 'cp1', { to: 'IN_PRODUCTION' }, 'u1'),
      ).rejects.toBeInstanceOf(UnprocessableEntityException);

      // O critério da spec é "nenhuma transição gravada" — não basta o 422.
      expect(prisma.clientProject.update).not.toHaveBeenCalled();
      expect(prisma.clientStatusTransition.create).not.toHaveBeenCalled();
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('drag-and-drop passa pela MESMA validação (não é porta dos fundos)', async () => {
      const prisma = prismaFake();
      prisma.clientProject.findFirst.mockResolvedValue({
        id: 'cp1',
        state: 'DRAFT',
        client: { id: 'c1' },
      });

      const svc = new ClientsService(prisma);
      // Arrastar de "novo" direto para "produção e entrega" é o mesmo pulo que
      // o teste anterior faz por API — e tem de morrer igual.
      await expect(
        svc.transition(TENANT, 'cp1', { column: 'producao_entrega' }, 'u1'),
      ).rejects.toBeInstanceOf(UnprocessableEntityException);
      expect(prisma.clientProject.update).not.toHaveBeenCalled();
    });

    it('mover dentro da mesma coluna é no-op, não erro nem trilha', async () => {
      const project = { id: 'cp1', state: 'DRAFT', client: { id: 'c1' } };
      const prisma = prismaFake();
      prisma.clientProject.findFirst.mockResolvedValue(project);

      const svc = new ClientsService(prisma);
      const out = await svc.transition(TENANT, 'cp1', { column: 'novo' }, 'u1');

      expect(out).toBe(project);
      expect(prisma.clientStatusTransition.create).not.toHaveBeenCalled();
    });

    it('coluna inexistente → 422', async () => {
      const prisma = prismaFake();
      prisma.clientProject.findFirst.mockResolvedValue({
        id: 'cp1',
        state: 'DRAFT',
        client: { id: 'c1' },
      });
      const svc = new ClientsService(prisma);
      await expect(
        svc.transition(TENANT, 'cp1', { column: 'inventada' }, 'u1'),
      ).rejects.toBeInstanceOf(UnprocessableEntityException);
    });

    it('sem `to` nem `column` → 422', async () => {
      const prisma = prismaFake();
      prisma.clientProject.findFirst.mockResolvedValue({
        id: 'cp1',
        state: 'DRAFT',
        client: { id: 'c1' },
      });
      const svc = new ClientsService(prisma);
      await expect(svc.transition(TENANT, 'cp1', {}, 'u1')).rejects.toBeInstanceOf(
        UnprocessableEntityException,
      );
    });

    it('projeto de outro tenant → 404, sem vazar existência', async () => {
      // findFirst filtra por `client.tenantId`; alheio não casa e volta null.
      const prisma = prismaFake();
      const svc = new ClientsService(prisma);
      await expect(
        svc.transition(TENANT, 'alheio', { to: 'LINK_SENT' }, 'u1'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('exclusão lógica', () => {
    it('deleteClient carimba deletedAt em vez de apagar a linha', async () => {
      const prisma = prismaFake();
      prisma.client.findFirst.mockResolvedValue({ id: 'c1', projects: [] });
      prisma.client.update.mockResolvedValue({});

      const svc = new ClientsService(prisma);
      await svc.deleteClient(TENANT, 'c1');

      const call = prisma.client.update.mock.calls[0][0];
      expect(call.where).toEqual({ id: 'c1' });
      expect(call.data.deletedAt).toBeInstanceOf(Date);
      // A trilha do funil não pode ser tocada por uma exclusão de cliente.
      expect(prisma.clientStatusTransition.create).not.toHaveBeenCalled();
    });

    it('cliente já excluído não é encontrado (some das listas)', async () => {
      const prisma = prismaFake(); // findFirst devolve null: filtro deletedAt:null
      const svc = new ClientsService(prisma);
      await expect(svc.getClient(TENANT, 'c1')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('escopo por tenant', () => {
    it('listClients filtra por tenant e por não-excluído', async () => {
      const prisma = prismaFake();
      const svc = new ClientsService(prisma);
      await svc.listClients(TENANT);

      expect(prisma.client.findMany.mock.calls[0][0].where).toEqual({
        tenantId: TENANT,
        deletedAt: null,
      });
    });

    it('busca cobre nome, empresa e CNPJ (critério da spec)', async () => {
      const prisma = prismaFake();
      const svc = new ClientsService(prisma);
      await svc.listClients(TENANT, 'acme');

      const or = prisma.client.findMany.mock.calls[0][0].where.OR;
      expect(or.map((c: Record<string, unknown>) => Object.keys(c)[0])).toEqual([
        'name',
        'company',
        'cnpj',
      ]);
    });

    it('board escopa os cards pelo tenant do CLIENTE (filha por join)', async () => {
      const prisma = prismaFake();
      const svc = new ClientsService(prisma);
      await svc.getBoard(TENANT);

      // `client_projects` não tem tenant_id: o escopo vem do join a `clients`.
      expect(prisma.clientProject.findMany.mock.calls[0][0].where).toMatchObject({
        deletedAt: null,
        client: { tenantId: TENANT, deletedAt: null },
      });
    });

    it('board devolve as 4 colunas na ordem, com os cards distribuídos', async () => {
      const prisma = prismaFake();
      prisma.clientProject.findMany.mockResolvedValue([
        { id: 'a', state: 'DRAFT' },
        { id: 'b', state: 'BRIEFING_SUBMITTED' },
        { id: 'c', state: 'DELIVERED' },
        { id: 'd', state: 'LINK_SENT' },
      ]);

      const svc = new ClientsService(prisma);
      const board = await svc.getBoard(TENANT);

      expect(board.columns.map((c) => c.column)).toEqual([
        'novo',
        'briefing',
        'prompt_contrato',
        'producao_entrega',
      ]);
      // DRAFT e LINK_SENT caem os dois em "novo" — estados internos são mais
      // finos que as colunas.
      expect(board.columns[0].cards.map((c) => c.id)).toEqual(['a', 'd']);
      expect(board.columns[1].cards.map((c) => c.id)).toEqual(['b']);
      expect(board.columns[2].cards).toHaveLength(0);
      expect(board.columns[3].cards.map((c) => c.id)).toEqual(['c']);
    });
  });

  describe('auditoria', () => {
    it('falha ao auditar não derruba a operação de negócio', async () => {
      const project = { id: 'cp1', state: 'DRAFT', client: { id: 'c1' } };
      const prisma = prismaFake();
      prisma.clientProject.findFirst.mockResolvedValue(project);
      prisma.clientProject.update.mockResolvedValue({ ...project, state: 'LINK_SENT' });
      prisma.clientStatusTransition.create.mockResolvedValue({});
      prisma.auditEvent.create.mockRejectedValue(new Error('audit down'));

      const svc = new ClientsService(prisma);
      // A transição já commitou no $transaction; desfazê-la por causa do evento
      // de auditoria seria pior que perder o evento.
      await expect(
        svc.transition(TENANT, 'cp1', { to: 'LINK_SENT' }, 'u1'),
      ).resolves.toMatchObject({ state: 'LINK_SENT' });
    });
  });
});
