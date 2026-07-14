import { InsightService } from './insight.service';
import { fakeRecorder, fakeUsageGate } from './fake-recorder';

// Client mock com `model` — entra no inputHash (SPEC-011); sem ele o hash
// computaria com model:undefined e o gate ficaria frouxo.
function edgesClient() {
  return {
    provider: 'anthropic',
    model: 'claude-sonnet-5',
    complete: jest.fn().mockResolvedValue({
      text: '[{"sourcePath":"docs/a.md","targetPath":"docs/b.md","motivo":"X"}]',
      model: 'm',
      inputTokens: 10,
      outputTokens: 5,
    }),
  };
}

function twoDocs() {
  return [
    { path: 'docs/a.md', content: '# A\nfala de X' },
    { path: 'docs/b.md', content: '# B\nfala de X' },
  ];
}

describe('InsightService.generateEdges', () => {
  it('cache-hit (inputHash bate) → não chama IA, não reescreve arestas, registra reused', async () => {
    // O gate monta o prompt (lê docs) e SÓ ENTÃO consulta o Insight por inputHash.
    // findFirst devolve um artefato → hit → reusa.
    const prisma = {
      project: { findUnique: jest.fn().mockResolvedValue({ id: 'p1', userId: 'u1', docsScopeHash: 'h1' }) },
      insight: { findFirst: jest.fn().mockResolvedValue({ id: 'cached' }), create: jest.fn() },
      document: { findMany: jest.fn().mockResolvedValue(twoDocs()) },
      docLink: { findMany: jest.fn().mockResolvedValue([]) },
      insightRun: { create: jest.fn().mockResolvedValue({}) },
    } as any;
    const llmFactory = { create: jest.fn().mockReturnValue(edgesClient()) } as any;
    const ingestion = { writeInferredEdges: jest.fn() } as any;
    const settings = { providerOf: jest.fn().mockResolvedValue('anthropic') } as any;
    const svc = new InsightService(prisma, settings, llmFactory, ingestion, {} as any, fakeRecorder(), fakeUsageGate());

    await svc.generateEdges('p1');

    expect(prisma.insight.create).not.toHaveBeenCalled();
    expect(ingestion.writeInferredEdges).not.toHaveBeenCalled();
    expect(prisma.insightRun.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ kind: 'edges_marker', outcome: 'reused' }) }),
    );
  });

  it('miss: chama IA, entrega ao ingestion, grava marker com inputHash + docsScopeHash, registra generated', async () => {
    const client = edgesClient();
    const prisma = {
      project: { findUnique: jest.fn().mockResolvedValue({ id: 'p1', userId: 'u1', docsScopeHash: 'h1' }) },
      insight: { findFirst: jest.fn().mockResolvedValue(null), create: jest.fn().mockResolvedValue({}) },
      document: { findMany: jest.fn().mockResolvedValue(twoDocs()) },
      docLink: { findMany: jest.fn().mockResolvedValue([]) },
      insightRun: { create: jest.fn().mockResolvedValue({}) },
    } as any;
    const llmFactory = { create: jest.fn().mockReturnValue(client) } as any;
    const ingestion = { writeInferredEdges: jest.fn().mockResolvedValue(undefined) } as any;
    const settings = { providerOf: jest.fn().mockResolvedValue('anthropic') } as any;
    const svc = new InsightService(prisma, settings, llmFactory, ingestion, {} as any, fakeRecorder(), fakeUsageGate());

    await svc.generateEdges('p1');

    expect(ingestion.writeInferredEdges).toHaveBeenCalledWith('p1', [
      { sourcePath: 'docs/a.md', targetPath: 'docs/b.md', reason: 'X' },
    ]);
    expect(prisma.insight.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          kind: 'edges_marker',
          docsScopeHash: 'h1',
          inputHash: expect.stringMatching(/^[0-9a-f]{64}$/),
        }),
      }),
    );
    expect(prisma.insightRun.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ kind: 'edges_marker', outcome: 'generated' }) }),
    );
  });

  it('force ignora o cache-hit e chama a IA (Regenerar — SPEC-011 item 5)', async () => {
    const prisma = {
      project: { findUnique: jest.fn().mockResolvedValue({ id: 'p1', userId: 'u1', docsScopeHash: 'h1' }) },
      insight: { findFirst: jest.fn().mockResolvedValue({ id: 'cached' }), create: jest.fn().mockResolvedValue({}) },
      document: { findMany: jest.fn().mockResolvedValue(twoDocs()) },
      docLink: { findMany: jest.fn().mockResolvedValue([]) },
      insightRun: { create: jest.fn().mockResolvedValue({}) },
    } as any;
    const ingestion = { writeInferredEdges: jest.fn().mockResolvedValue(undefined) } as any;
    const llmFactory = { create: jest.fn().mockReturnValue(edgesClient()) } as any;
    const settings = { providerOf: jest.fn().mockResolvedValue('anthropic') } as any;
    const svc = new InsightService(prisma, settings, llmFactory, ingestion, {} as any, fakeRecorder(), fakeUsageGate());

    await svc.generateEdges('p1', { force: true });

    expect(ingestion.writeInferredEdges).toHaveBeenCalled();
    expect(prisma.insight.create).toHaveBeenCalled();
    expect(prisma.insightRun.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ outcome: 'generated' }) }),
    );
  });
});
