import { InsightService } from './insight.service';
import { fakeRecorder } from './fake-recorder';

function makeSvc(overrides: {
  prisma?: any;
  resolution?: any;
  llmFactory?: any;
  ingestion?: any;
  settings?: any;
}) {
  const prisma = overrides.prisma ?? {
    project: { findUnique: jest.fn().mockResolvedValue({ id: 'p1', userId: 'u1', docsScopeHash: 'h1' }) },
    insight: { findFirst: jest.fn().mockResolvedValue(null), create: jest.fn().mockResolvedValue({}) },
    document: { findMany: jest.fn().mockResolvedValue([{ path: 'docs/a.md', content: 'conteúdo A' }]) },
  };
  const settings = overrides.settings ?? { providerOf: jest.fn().mockResolvedValue('anthropic') };
  const llmFactory = overrides.llmFactory ?? { create: jest.fn() };
  const ingestion = overrides.ingestion ?? {};
  const resolution =
    overrides.resolution ??
    ({ resolutionOf: jest.fn().mockResolvedValue({ entity: 'architecture', level: 4, source: 'absent', path: null, paths: [], confidence: 0 }) } as any);
  const svc = new InsightService(prisma, settings, llmFactory, ingestion, resolution, fakeRecorder());
  return { svc, prisma, settings, llmFactory, ingestion, resolution };
}

describe('InsightService.generateFallback', () => {
  it('idempotente: marker architecture_fallback do hash existe → não chama IA', async () => {
    const prisma = {
      project: { findUnique: jest.fn().mockResolvedValue({ id: 'p1', userId: 'u1', docsScopeHash: 'h1' }) },
      insight: { findFirst: jest.fn().mockResolvedValue({ id: 'marker' }), create: jest.fn() },
      document: { findMany: jest.fn() },
    };
    const { svc, llmFactory } = makeSvc({ prisma });
    await svc.generateFallback('p1', 'architecture');
    expect(llmFactory.create).not.toHaveBeenCalled();
    expect(prisma.insight.create).not.toHaveBeenCalled();
  });

  it('entidade não-ausente (convention/inference) → não chama IA, não persiste', async () => {
    const resolution = {
      resolutionOf: jest.fn().mockResolvedValue({ entity: 'architecture', level: 1, source: 'convention', path: 'docs/ARCHITECTURE.md', paths: [], confidence: 1 }),
    };
    const { svc, llmFactory, prisma } = makeSvc({ resolution });
    await svc.generateFallback('p1', 'architecture');
    expect(llmFactory.create).not.toHaveBeenCalled();
    expect(prisma.insight.create).not.toHaveBeenCalled();
  });

  it('ausente + docs presentes → chama IA, persiste Insight architecture_fallback com content.markdown', async () => {
    const client = {
      provider: 'anthropic',
      complete: jest.fn().mockResolvedValue({ text: '# Arquitetura\n\nInferido.', model: 'm', inputTokens: 20, outputTokens: 10 }),
    };
    const llmFactory = { create: jest.fn().mockReturnValue(client) };
    const { svc, prisma } = makeSvc({ llmFactory });

    await svc.generateFallback('p1', 'architecture');

    expect(client.complete).toHaveBeenCalledTimes(1);
    expect(prisma.insight.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        projectId: 'p1',
        kind: 'architecture_fallback',
        docsTreeSha: 'h1',
        provider: 'anthropic',
        model: 'm',
        inputTokens: 20,
        outputTokens: 10,
        content: { markdown: '# Arquitetura\n\nInferido.' },
      }),
    });
  });

  it('1 retry em erro de chamada: 1ª lança, 2ª retorna → persiste', async () => {
    const client = {
      provider: 'anthropic',
      complete: jest
        .fn()
        .mockRejectedValueOnce(new Error('timeout'))
        .mockResolvedValueOnce({ text: '# Design\n\nInferido.', model: 'm', inputTokens: 5, outputTokens: 3 }),
    };
    const llmFactory = { create: jest.fn().mockReturnValue(client) };
    const resolution = {
      resolutionOf: jest.fn().mockResolvedValue({ entity: 'design', level: 4, source: 'absent', path: null, paths: [], confidence: 0 }),
    };
    const { svc, prisma } = makeSvc({ llmFactory, resolution });

    await svc.generateFallback('p1', 'design');

    expect(client.complete).toHaveBeenCalledTimes(2);
    expect(prisma.insight.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ kind: 'design_fallback', content: { markdown: '# Design\n\nInferido.' } }) }),
    );
  });
});
