import { ResolutionService } from './resolution.service';

function makePrisma(docs: { path: string; isConventional: boolean; content: string }[]) {
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
