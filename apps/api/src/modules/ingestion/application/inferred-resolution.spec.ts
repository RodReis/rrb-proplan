import { ResolutionService } from './resolution.service';

describe('ResolutionService.writeInferredResolution', () => {
  it('atualiza linha absent p/ nível 3 inference', async () => {
    const prisma = {
      documentResolution: {
        findUnique: jest.fn().mockResolvedValue({ source: 'absent', level: 4 }),
        update: jest.fn().mockResolvedValue({}),
      },
    } as any;
    const svc = new ResolutionService(prisma);

    await svc.writeInferredResolution('p1', 'architecture', 'docs/notas.md', 0.7);

    expect(prisma.documentResolution.findUnique).toHaveBeenCalledWith({
      where: { projectId_entity: { projectId: 'p1', entity: 'architecture' } },
    });
    expect(prisma.documentResolution.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { projectId_entity: { projectId: 'p1', entity: 'architecture' } },
        data: expect.objectContaining({
          level: 3,
          source: 'inference',
          path: 'docs/notas.md',
          confidence: 0.7,
        }),
      }),
    );
  });

  it('NÃO sobrescreve linha config/alias/convention', async () => {
    const prisma = {
      documentResolution: {
        findUnique: jest.fn().mockResolvedValue({ source: 'config', level: 1 }),
        update: jest.fn(),
      },
    } as any;
    const svc = new ResolutionService(prisma);

    await svc.writeInferredResolution('p1', 'architecture', 'docs/x.md', 0.7);

    expect(prisma.documentResolution.update).not.toHaveBeenCalled();
  });
});
