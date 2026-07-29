import { EstimatesSummaryService } from './estimates-summary.service';

const TENANT = 't1';

function prismaFake(): any {
  return {
    briefingVersion: { findMany: jest.fn().mockResolvedValue([]) },
    estimate: { findMany: jest.fn().mockResolvedValue([]) },
  };
}

function briefing(id: string, titulo: string, quando = '2026-08-01T10:00:00.000Z') {
  return {
    clientProjectId: id,
    submittedAt: new Date(quando),
    clientProject: { title: titulo },
  };
}

describe('EstimatesSummaryService (SPEC-035 §2.3, item 2)', () => {
  it('briefing recebido e nenhuma estimativa → `missing`', async () => {
    const prisma = prismaFake();
    prisma.briefingVersion.findMany.mockResolvedValue([briefing('cp1', 'Loja nova')]);

    const out = await new EstimatesSummaryService(prisma).pending(TENANT);

    expect(out).toEqual([
      {
        clientProjectId: 'cp1',
        title: 'Loja nova',
        reason: 'missing',
        since: '2026-08-01T10:00:00.000Z',
      },
    ]);
  });

  it('estimativa gerada e não aprovada → `unapproved`', async () => {
    // Os dois esperam a mesma pessoa, mas pedem ações diferentes. "Pendente"
    // sem dizer o quê obriga a abrir o card para descobrir.
    const prisma = prismaFake();
    prisma.briefingVersion.findMany.mockResolvedValue([briefing('cp1', 'Loja nova')]);
    prisma.estimate.findMany.mockResolvedValue([
      { clientProjectId: 'cp1', approvedAt: null, createdAt: new Date() },
    ]);

    const out = await new EstimatesSummaryService(prisma).pending(TENANT);

    expect(out[0].reason).toBe('unapproved');
  });

  it('estimativa aprovada tira o projeto da lista', async () => {
    const prisma = prismaFake();
    prisma.briefingVersion.findMany.mockResolvedValue([briefing('cp1', 'Loja nova')]);
    prisma.estimate.findMany.mockResolvedValue([
      { clientProjectId: 'cp1', approvedAt: new Date(), createdAt: new Date() },
    ]);

    expect(await new EstimatesSummaryService(prisma).pending(TENANT)).toEqual([]);
  });

  it('uma aprovada entre várias basta — o que espera é a DECISÃO, e ela foi tomada', async () => {
    const prisma = prismaFake();
    prisma.briefingVersion.findMany.mockResolvedValue([briefing('cp1', 'Loja nova')]);
    prisma.estimate.findMany.mockResolvedValue([
      { clientProjectId: 'cp1', approvedAt: null, createdAt: new Date() },
      { clientProjectId: 'cp1', approvedAt: new Date(), createdAt: new Date() },
    ]);

    expect(await new EstimatesSummaryService(prisma).pending(TENANT)).toEqual([]);
  });

  it('projeto com DOIS briefings entra UMA vez — senão o contador conta duplicado', async () => {
    // O contador do menu é o tamanho desta lista (§2.3). Projeto repetido aqui
    // faria o número dizer 2 onde há 1 coisa a fazer, e o §5 exige que menu e
    // lista não possam divergir.
    const prisma = prismaFake();
    prisma.briefingVersion.findMany.mockResolvedValue([
      briefing('cp1', 'Loja nova', '2026-08-01T10:00:00.000Z'),
      briefing('cp1', 'Loja nova', '2026-08-05T10:00:00.000Z'),
    ]);

    const out = await new EstimatesSummaryService(prisma).pending(TENANT);

    expect(out).toHaveLength(1);
    // Fica o mais antigo: é desde quando o projeto está travado.
    expect(out[0].since).toBe('2026-08-01T10:00:00.000Z');
  });

  it('projeto sem briefing não entra — sem briefing não há o que estimar', async () => {
    const prisma = prismaFake();

    const out = await new EstimatesSummaryService(prisma).pending(TENANT);

    expect(out).toEqual([]);
    // Sem briefing nenhum, nem consulta estimativas — não há projeto a checar.
    expect(prisma.estimate.findMany).not.toHaveBeenCalled();
  });

  it('entregue e arquivado ficam de fora — é o fim normal do funil', async () => {
    const prisma = prismaFake();

    await new EstimatesSummaryService(prisma).pending(TENANT);

    const where = prisma.briefingVersion.findMany.mock.calls[0][0].where;
    expect(where.clientProject.state).toEqual({ notIn: ['DELIVERED', 'ARCHIVED'] });
    expect(where.clientProject.client).toEqual({ tenantId: TENANT, deletedAt: null });
  });
});
