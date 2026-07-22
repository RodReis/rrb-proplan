import { transactionMock } from '../../../../test/prisma-transaction-mock';
import { ResolutionService } from './resolution.service';

function makePrisma(
  docs: { path: string; isConventional: boolean; content: string }[],
  inferredRows: any[] = [],
) {
  const created: any[] = [];
  // `any` explícito no fake: o `$transaction` referencia `fake.prisma` (o `tx`
  // do callback é o próprio fake) e sem a anotação o TS acusa auto-referência.
  // O `created` acima segue tipado — é dele que os testes leem.
  const fake: { created: any[]; prisma: any } = {
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
      $transaction: transactionMock(() => fake.prisma),
    } as any,
  };
  return fake;
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

  it('entidade absent na escada + tinha linha inference + doc ainda existe → preserva nível 3 inference', async () => {
    const { prisma, created } = makePrisma(
      [
        { path: 'docs/arquitetura.md', isConventional: false, content: '# a' },
        { path: 'docs/notas-qa.md', isConventional: false, content: '# qa' },
      ],
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

  it('entidade absent na escada + tinha linha inference, mas doc foi deletado → NÃO preserva, cai para absent', async () => {
    // 'testing' segue absent na escada (nenhum doc convencional/alias no doc-set).
    // A linha inference aponta para docs/notas.md, que NÃO está no doc-set atual
    // (foi deletado num sync posterior) — não pode ser preservada.
    const { prisma, created } = makePrisma(
      [{ path: 'docs/arquitetura.md', isConventional: false, content: '# a' }],
      [
        {
          entity: 'testing',
          level: 3,
          source: 'inference',
          path: 'docs/notas.md',
          paths: [],
          confidence: 0.7,
        },
      ],
    );
    const svc = new ResolutionService(prisma);

    await svc.rebuild('p1');

    const testingRow = created.find((r) => r.entity === 'testing');
    expect(testingRow).toEqual(
      expect.objectContaining({ level: 4, source: 'absent', path: null }),
    );
    expect(testingRow.source).not.toBe('inference');
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

  it('config com entity:null (decisão humana) + tinha inference → config vence, inference descartada', async () => {
    const { prisma, created } = makePrisma(
      [
        {
          path: '.proplan/config.yml',
          isConventional: false,
          content: 'proplan: v2\nmapping:\n  architecture: null\n',
        },
      ],
      [
        {
          entity: 'architecture',
          level: 3,
          source: 'inference',
          path: 'docs/notas.md',
          paths: [],
          confidence: 0.7,
        },
      ],
    );
    const svc = new ResolutionService(prisma);

    await svc.rebuild('p1');

    const architectureRow = created.find((r) => r.entity === 'architecture');
    expect(architectureRow).toEqual(
      expect.objectContaining({ level: 4, source: 'config', path: null }),
    );
    expect(architectureRow.source).not.toBe('inference');
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
