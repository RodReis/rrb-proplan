import { BadRequestException } from '@nestjs/common';
import { TabsService } from './tabs.service';

describe('TabsService.getTab — fallback inferido (architecture/design)', () => {
  it('architecture ausente + fallback existe → payload markdown com inferred:true', async () => {
    const resolution = { entity: 'architecture', level: 4, source: 'absent', path: null, paths: [], confidence: 0 };
    const prisma = { document: { findMany: jest.fn() } } as any;
    const ingestion = { resolutionOf: jest.fn().mockResolvedValue(resolution) } as any;
    const insight = {
      latestClassifySpans: jest.fn(),
      latestFallbackInternal: jest.fn().mockResolvedValue({ content: { markdown: '# Arquitetura inferida' } }),
    } as any;
    const svc = new TabsService(prisma, ingestion, insight, {} as any, {} as any, {} as any);

    const out = await svc.getTab('p1', 'architecture');

    expect(out.source.level).toBe(4);
    expect(out.payload).toEqual({ markdown: '# Arquitetura inferida', inferred: true });
    expect(insight.latestFallbackInternal).toHaveBeenCalledWith('p1', 'architecture');
  });

  it('design ausente + sem fallback → payload null', async () => {
    const resolution = { entity: 'design', level: 4, source: 'absent', path: null, paths: [], confidence: 0 };
    const prisma = { document: { findMany: jest.fn() } } as any;
    const ingestion = { resolutionOf: jest.fn().mockResolvedValue(resolution) } as any;
    const insight = {
      latestClassifySpans: jest.fn(),
      latestFallbackInternal: jest.fn().mockResolvedValue(null),
    } as any;
    const svc = new TabsService(prisma, ingestion, insight, {} as any, {} as any, {} as any);

    const out = await svc.getTab('p1', 'design');

    expect(out.payload).toBeNull();
  });

  it('entidade não-arch/design ausente (ex.: deploy) → não consulta fallback, payload null', async () => {
    const resolution = { entity: 'deploy', level: 4, source: 'absent', path: null, paths: [], confidence: 0 };
    const prisma = { document: { findUnique: jest.fn(), findMany: jest.fn() } } as any;
    const ingestion = { resolutionOf: jest.fn().mockResolvedValue(resolution) } as any;
    const insight = {
      latestClassifySpans: jest.fn(),
      latestFallbackInternal: jest.fn(),
    } as any;
    const svc = new TabsService(prisma, ingestion, insight, {} as any, {} as any, {} as any);

    const out = await svc.getTab('p1', 'deploy');

    expect(out.payload).toBeNull();
    expect(insight.latestFallbackInternal).not.toHaveBeenCalled();
  });
});

describe('TabsService.promote', () => {
  function makeDeps(overrides: Partial<{ project: any }> = {}) {
    const prisma = {
      project: {
        findFirst: jest.fn().mockResolvedValue({ id: 'p1', userId: 'u1' }),
        findUnique: jest.fn().mockResolvedValue(
          overrides.project ?? { id: 'p1', userId: 'u1', owner: 'o', name: 'r', defaultBranch: 'main' },
        ),
      },
    } as any;
    const ingestion = { resolutionOf: jest.fn() } as any;
    const insight = { latestClassifySpans: jest.fn(), latestFallbackInternal: jest.fn() } as any;
    const auth = { installationToken: jest.fn().mockResolvedValue('tok') } as any;
    const writeback = {
      getFileSha: jest.fn().mockResolvedValue(null),
      putFile: jest.fn().mockResolvedValue('sha2'),
    } as any;
    const ingestionWrite = { enqueueSync: jest.fn().mockResolvedValue({ syncRunId: 'run1' }) } as any;
    return { prisma, ingestion, insight, auth, writeback, ingestionWrite };
  }

  it('architecture: commita docs/ARCHITECTURE.md com o content do body + enqueueSync', async () => {
    const { prisma, ingestion, insight, auth, writeback, ingestionWrite } = makeDeps();
    const svc = new TabsService(prisma, ingestion, insight, auth, writeback, ingestionWrite);

    const out = await svc.promote('u1', 'p1', 'architecture', '# Doc revisado');

    expect(auth.installationToken).toHaveBeenCalledWith('p1');
    const putArg = writeback.putFile.mock.calls[0][0];
    expect(putArg.path).toBe('docs/ARCHITECTURE.md');
    expect(putArg.content).toBe('# Doc revisado');
    expect(putArg.baseSha).toBeNull();
    expect(ingestionWrite.enqueueSync).toHaveBeenCalledWith('p1');
    expect(out.syncRunId).toBe('run1');
  });

  it('design: commita docs/DESIGN.md', async () => {
    const { prisma, ingestion, insight, auth, writeback, ingestionWrite } = makeDeps();
    const svc = new TabsService(prisma, ingestion, insight, auth, writeback, ingestionWrite);

    await svc.promote('u1', 'p1', 'design', '# Design revisado');

    const putArg = writeback.putFile.mock.calls[0][0];
    expect(putArg.path).toBe('docs/DESIGN.md');
  });

  it('tab inválido (ex.: decisions) → BadRequestException', async () => {
    const { prisma, ingestion, insight, auth, writeback, ingestionWrite } = makeDeps();
    const svc = new TabsService(prisma, ingestion, insight, auth, writeback, ingestionWrite);

    await expect(svc.promote('u1', 'p1', 'decisions' as any, 'x')).rejects.toThrow(BadRequestException);
    expect(auth.installationToken).not.toHaveBeenCalled();
  });
});
