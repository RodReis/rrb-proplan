import { InsightService } from './insight.service';
import { fakeRecorder, fakeUsageGate } from './fake-recorder';

// resolutionOf que devolve `architecture` ausente e o resto por convenção.
function resolutionArchAbsent() {
  return {
    resolutionOf: jest.fn().mockImplementation((_projectId: string, entity: string) => {
      if (entity === 'architecture') {
        return Promise.resolve({ entity, level: 4, source: 'absent', path: null, paths: [], confidence: 0 });
      }
      return Promise.resolve({ entity, level: 1, source: 'convention', path: `docs/${entity}.md`, paths: [], confidence: 1 });
    }),
    writeInferredResolution: jest.fn().mockResolvedValue(undefined),
  };
}

function classifyClient() {
  return {
    provider: 'anthropic',
    model: 'claude-sonnet-5',
    complete: jest.fn().mockResolvedValue({
      text: '[{"entity":"architecture","path":"docs/tech.md","spans":["Descreve os módulos e a comunicação entre eles"]}]',
      model: 'm',
      inputTokens: 10,
      outputTokens: 5,
    }),
  };
}

function twoDocs() {
  return [
    { path: 'docs/tech.md', content: '# Tech\nDescreve os módulos e a comunicação entre eles' },
    { path: 'docs/CONVENTION.md', content: '# Convenção' },
  ];
}

describe('InsightService.classifyAbsent', () => {
  it('cache-hit (inputHash bate) → não chama IA nem writeInferredResolution, registra reused', async () => {
    // O gate roda DEPOIS de montar o prompt (resolutionOf + docs livres). Com
    // um artefato do mesmo inputHash → hit → reusa (a resolução nível 3 já foi
    // preservada pelo rebuild do sync).
    const prisma = {
      project: { findUnique: jest.fn().mockResolvedValue({ id: 'p1', userId: 'u1', docsScopeHash: 'h1' }) },
      insight: { findFirst: jest.fn().mockResolvedValue({ id: 'cached' }), create: jest.fn() },
      document: { findMany: jest.fn().mockResolvedValue(twoDocs()) },
      insightRun: { create: jest.fn().mockResolvedValue({}) },
    } as any;
    const llmFactory = { create: jest.fn().mockReturnValue(classifyClient()) } as any;
    const settings = { providerOf: jest.fn().mockResolvedValue('anthropic') } as any;
    const resolution = resolutionArchAbsent();
    const svc = new InsightService(prisma, settings, llmFactory, {} as any, resolution as any, fakeRecorder(), fakeUsageGate());

    await svc.classifyAbsent('p1');

    expect(resolution.writeInferredResolution).not.toHaveBeenCalled();
    expect(prisma.insight.create).not.toHaveBeenCalled();
    expect(prisma.insightRun.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ kind: 'classify_marker', outcome: 'reused' }) }),
    );
  });

  it('sem docsScopeHash → return sem IA', async () => {
    const prisma = {
      project: { findUnique: jest.fn().mockResolvedValue({ id: 'p1', userId: 'u1', docsScopeHash: null }) },
    } as any;
    const llmFactory = { create: jest.fn() } as any;
    const settings = { providerOf: jest.fn() } as any;
    const resolution = { resolutionOf: jest.fn(), writeInferredResolution: jest.fn() } as any;
    const svc = new InsightService(prisma, settings, llmFactory, {} as any, resolution, fakeRecorder(), fakeUsageGate());

    await svc.classifyAbsent('p1');

    expect(llmFactory.create).not.toHaveBeenCalled();
  });

  it('miss: entidades absent, docs livres, IA retorna 1 hit → writeInferredResolution + marker com inputHash, registra generated', async () => {
    const prisma = {
      project: { findUnique: jest.fn().mockResolvedValue({ id: 'p1', userId: 'u1', docsScopeHash: 'h1' }) },
      insight: { findFirst: jest.fn().mockResolvedValue(null), create: jest.fn().mockResolvedValue({}) },
      document: { findMany: jest.fn().mockResolvedValue(twoDocs()) },
      insightRun: { create: jest.fn().mockResolvedValue({}) },
    } as any;
    const llmFactory = { create: jest.fn().mockReturnValue(classifyClient()) } as any;
    const settings = { providerOf: jest.fn().mockResolvedValue('anthropic') } as any;
    const resolution = resolutionArchAbsent();
    const svc = new InsightService(prisma, settings, llmFactory, {} as any, resolution as any, fakeRecorder(), fakeUsageGate());

    await svc.classifyAbsent('p1');

    expect(resolution.writeInferredResolution).toHaveBeenCalledWith('p1', 'architecture', 'docs/tech.md', 0.7);
    expect(prisma.insight.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          kind: 'classify_marker',
          docsScopeHash: 'h1',
          inputHash: expect.stringMatching(/^[0-9a-f]{64}$/),
          content: expect.objectContaining({
            hits: [{ entity: 'architecture', path: 'docs/tech.md', spans: ['Descreve os módulos e a comunicação entre eles'] }],
          }),
        }),
      }),
    );
    expect(prisma.insightRun.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ kind: 'classify_marker', outcome: 'generated' }) }),
    );
    // ordem: resolução escrita antes do marker
    const writeOrder = resolution.writeInferredResolution.mock.invocationCallOrder[0];
    const markerOrder = prisma.insight.create.mock.invocationCallOrder[0];
    expect(writeOrder).toBeLessThan(markerOrder);
  });

  it('deploy absent não é oferecido/classificado mesmo se IA tentar', async () => {
    const prisma = {
      project: { findUnique: jest.fn().mockResolvedValue({ id: 'p1', userId: 'u1', docsScopeHash: 'h1' }) },
      insight: { findFirst: jest.fn().mockResolvedValue(null), create: jest.fn().mockResolvedValue({}) },
      document: {
        findMany: jest.fn().mockResolvedValue([{ path: 'docs/free.md', content: '# Free\nAlgum conteúdo livre' }]),
      },
      insightRun: { create: jest.fn().mockResolvedValue({}) },
    } as any;
    const llmFactory = { create: jest.fn() } as any;
    const settings = { providerOf: jest.fn().mockResolvedValue('anthropic') } as any;
    const resolution = {
      resolutionOf: jest.fn().mockImplementation((_projectId: string, entity: string) => {
        if (entity === 'deploy') {
          return Promise.resolve({ entity, level: 4, source: 'absent', path: null, paths: [], confidence: 0 });
        }
        return Promise.resolve({ entity, level: 1, source: 'convention', path: `docs/${entity}.md`, paths: [], confidence: 1 });
      }),
      writeInferredResolution: jest.fn().mockResolvedValue(undefined),
    } as any;
    const svc = new InsightService(prisma, settings, llmFactory, {} as any, resolution, fakeRecorder(), fakeUsageGate());

    await svc.classifyAbsent('p1');

    // deploy é a única absent e é excluída antes de consultar a IA
    // (CONVENTION.md: Deploy nunca é classificado) → nada a classificar → no-op
    expect(llmFactory.create).not.toHaveBeenCalled();
    expect(resolution.writeInferredResolution).not.toHaveBeenCalled();
    expect(prisma.insight.create).not.toHaveBeenCalled();
  });

  it('nenhuma entidade absent → return sem IA e sem marker', async () => {
    const prisma = {
      project: { findUnique: jest.fn().mockResolvedValue({ id: 'p1', userId: 'u1', docsScopeHash: 'h1' }) },
      insight: { findFirst: jest.fn().mockResolvedValue(null), create: jest.fn() },
      insightRun: { create: jest.fn() },
    } as any;
    const llmFactory = { create: jest.fn() } as any;
    const settings = { providerOf: jest.fn() } as any;
    const resolution = {
      resolutionOf: jest.fn().mockResolvedValue({ entity: 'x', level: 1, source: 'convention', path: 'docs/x.md', paths: [], confidence: 1 }),
      writeInferredResolution: jest.fn(),
    } as any;
    const svc = new InsightService(prisma, settings, llmFactory, {} as any, resolution, fakeRecorder(), fakeUsageGate());

    await svc.classifyAbsent('p1');

    expect(llmFactory.create).not.toHaveBeenCalled();
    expect(prisma.insight.create).not.toHaveBeenCalled();
  });
});

describe('InsightService.latestClassifySpans', () => {
  it('lê o classify_marker mais recente e extrai os spans do hit cuja entity bate', async () => {
    const prisma = {
      insight: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'marker',
          content: {
            hits: [
              { entity: 'architecture', path: 'docs/tech.md', spans: ['trecho A', 'trecho B'] },
              { entity: 'design', path: 'docs/ui.md', spans: ['trecho C'] },
            ],
          },
        }),
      },
    } as any;
    const svc = new InsightService(prisma, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any);

    const spans = await svc.latestClassifySpans('p1', 'architecture');

    expect(spans).toEqual(['trecho A', 'trecho B']);
    expect(prisma.insight.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { projectId: 'p1', kind: 'classify_marker' },
        orderBy: { createdAt: 'desc' },
      }),
    );
  });

  it('nenhum marker → []', async () => {
    const prisma = { insight: { findFirst: jest.fn().mockResolvedValue(null) } } as any;
    const svc = new InsightService(prisma, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any);

    const spans = await svc.latestClassifySpans('p1', 'architecture');

    expect(spans).toEqual([]);
  });

  it('marker existe mas nenhum hit bate a entity → []', async () => {
    const prisma = {
      insight: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'marker',
          content: { hits: [{ entity: 'design', path: 'docs/ui.md', spans: ['trecho C'] }] },
        }),
      },
    } as any;
    const svc = new InsightService(prisma, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any);

    const spans = await svc.latestClassifySpans('p1', 'architecture');

    expect(spans).toEqual([]);
  });
});
