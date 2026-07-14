import { InsightService } from './insight.service';
import { fakeRecorder, fakeUsageGate } from './fake-recorder';

describe('InsightService.generateEdges', () => {
  it('idempotente: marker do hash existe → não chama IA', async () => {
    const prisma = {
      project: { findUnique: jest.fn().mockResolvedValue({ id: 'p1', userId: 'u1', docsScopeHash: 'h1' }) },
      insight: { findFirst: jest.fn().mockResolvedValue({ id: 'marker' }) },
    } as any;
    const llmFactory = { create: jest.fn() } as any;
    const ingestion = { writeInferredEdges: jest.fn() } as any;
    const settings = { providerOf: jest.fn() } as any;
    const resolution = {} as any;
    const svc = new InsightService(prisma, settings, llmFactory, ingestion, resolution, fakeRecorder(), fakeUsageGate());
    await svc.generateEdges('p1');
    expect(llmFactory.create).not.toHaveBeenCalled();
    expect(ingestion.writeInferredEdges).not.toHaveBeenCalled();
  });

  it('gera: chama IA, entrega ao ingestion, grava marker', async () => {
    const prisma = {
      project: { findUnique: jest.fn().mockResolvedValue({ id: 'p1', userId: 'u1', docsScopeHash: 'h1' }) },
      insight: { findFirst: jest.fn().mockResolvedValue(null), create: jest.fn().mockResolvedValue({}) },
      document: { findMany: jest.fn().mockResolvedValue([{ path: 'docs/a.md', content: '# A\nfala de X' }, { path: 'docs/b.md', content: '# B\nfala de X' }]) },
      docLink: { findMany: jest.fn().mockResolvedValue([]) },
    } as any;
    const client = { provider: 'anthropic', complete: jest.fn().mockResolvedValue({ text: '[{"sourcePath":"docs/a.md","targetPath":"docs/b.md","motivo":"X"}]', model: 'm', inputTokens: 10, outputTokens: 5 }) };
    const llmFactory = { create: jest.fn().mockReturnValue(client) } as any;
    const ingestion = { writeInferredEdges: jest.fn().mockResolvedValue(undefined) } as any;
    const settings = { providerOf: jest.fn().mockResolvedValue('anthropic') } as any;
    const resolution = {} as any;
    const svc = new InsightService(prisma, settings, llmFactory, ingestion, resolution, fakeRecorder(), fakeUsageGate());
    await svc.generateEdges('p1');
    expect(ingestion.writeInferredEdges).toHaveBeenCalledWith('p1', [{ sourcePath: 'docs/a.md', targetPath: 'docs/b.md', reason: 'X' }]);
    expect(prisma.insight.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ kind: 'edges_marker', docsTreeSha: 'h1' }) }));
  });
});
