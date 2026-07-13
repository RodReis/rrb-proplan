import { ResolutionService } from './resolution.service';

function makePrisma(
  docs: { path: string; isConventional: boolean; content: string }[],
  inferredRows: any[] = [],
) {
  const created: any[] = [];
  return {
    created,
    prisma: {
      document: {
        findMany: jest.fn().mockResolvedValue(docs),
        findUnique: jest.fn().mockResolvedValue(
          docs.find((d) => d.path === '.proplan/config.yml') ?? null,
        ),
      },
      documentResolution: {
        findMany: jest.fn().mockResolvedValue(inferredRows),
        deleteMany: jest.fn().mockResolvedValue({}),
        createMany: jest.fn().mockImplementation(({ data }) => {
          created.push(...data);
          return Promise.resolve({});
        }),
      },
      project: { update: jest.fn().mockResolvedValue({}) },
      $transaction: jest.fn().mockImplementation((ops: Promise<unknown>[]) => Promise.all(ops)),
    } as any,
  };
}

describe('ResolutionService.rebuild', () => {
  it('persiste 6 resoluções e marca config válido', async () => {
    const { prisma, created } = makePrisma([
      { path: 'docs/arquitetura.md', isConventional: false, content: '# a' },
    ]);
    const svc = new ResolutionService(prisma);
    await svc.rebuild('p1');
    expect(created).toHaveLength(6);
    expect(created.find((r) => r.entity === 'architecture').source).toBe('alias');
    expect(prisma.project.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { proplanConfigInvalid: false } }),
    );
  });

  it('config inválido → flag true, ainda persiste (cai na escada)', async () => {
    const { prisma, created } = makePrisma([
      { path: '.proplan/config.yml', isConventional: false, content: 'mapping: [: :' },
    ]);
    const svc = new ResolutionService(prisma);
    await svc.rebuild('p1');
    expect(created).toHaveLength(6);
    expect(prisma.project.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { proplanConfigInvalid: true } }),
    );
  });

  it('entidade absent na escada + tinha linha inference → preserva nível 3 inference', async () => {
    const { prisma, created } = makePrisma(
      [{ path: 'docs/arquitetura.md', isConventional: false, content: '# a' }],
      [
        {
          entity: 'testing',
          level: 3,
          source: 'inference',
          path: 'docs/notas-qa.md',
          paths: [],
          confidence: 0.65,
        },
      ],
    );
    const svc = new ResolutionService(prisma);

    await svc.rebuild('p1');

    const testingRow = created.find((r) => r.entity === 'testing');
    expect(testingRow).toEqual(
      expect.objectContaining({
        level: 3,
        source: 'inference',
        path: 'docs/notas-qa.md',
        confidence: 0.65,
      }),
    );
  });

  it('entidade que a escada resolve como convention/alias + tinha inference → convenção vence', async () => {
    const { prisma, created } = makePrisma(
      [{ path: 'docs/arquitetura.md', isConventional: false, content: '# a' }],
      [
        {
          entity: 'architecture',
          level: 3,
          source: 'inference',
          path: 'docs/notas-antigas.md',
          paths: [],
          confidence: 0.5,
        },
      ],
    );
    const svc = new ResolutionService(prisma);

    await svc.rebuild('p1');

    const architectureRow = created.find((r) => r.entity === 'architecture');
    expect(architectureRow).toEqual(
      expect.objectContaining({ level: 2, source: 'alias', path: 'docs/arquitetura.md' }),
    );
  });
});

describe('ResolutionService.resolutionOf', () => {
  it('sem linha persistida (sync ainda não rodou) → devolve ausente, não lança', async () => {
    const prisma = {
      documentResolution: { findUnique: jest.fn().mockResolvedValue(null) },
    } as any;
    const svc = new ResolutionService(prisma);

    const result = await svc.resolutionOf('p1', 'architecture');

    expect(result).toEqual({
      entity: 'architecture',
      level: 4,
      source: 'absent',
      path: null,
      paths: [],
      confidence: 0,
    });
  });

  it('com linha persistida → mapeia os campos do row', async () => {
    const row = {
      entity: 'architecture',
      level: 1,
      source: 'convention',
      path: 'docs/ARCHITECTURE.md',
      paths: [],
      confidence: 1.0,
    };
    const prisma = {
      documentResolution: { findUnique: jest.fn().mockResolvedValue(row) },
    } as any;
    const svc = new ResolutionService(prisma);

    const result = await svc.resolutionOf('p1', 'architecture');

    expect(result).toEqual(row);
  });
});
