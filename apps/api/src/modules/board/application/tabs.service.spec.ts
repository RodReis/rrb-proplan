import { TabsService } from './tabs.service';

describe('TabsService.getTab — architecture', () => {
  it('resolvida → markdown do doc', async () => {
    const resolution = { entity: 'architecture', level: 1, source: 'convention', path: 'docs/ARCHITECTURE.md', paths: [], confidence: 1 };
    const prisma = {
      document: { findUnique: jest.fn().mockResolvedValue({ content: '# Arquitetura' }) },
    } as any;
    const ingestion = { resolutionOf: jest.fn().mockResolvedValue(resolution) } as any;
    const svc = new TabsService(prisma, ingestion);
    const out = await svc.getTab('p1', 'architecture');
    expect(out.source.level).toBe(1);
    expect(out.payload).toEqual({ markdown: '# Arquitetura' });
  });

  it('ausente → payload null', async () => {
    const resolution = { entity: 'architecture', level: 4, source: 'absent', path: null, paths: [], confidence: 0 };
    const prisma = { document: { findUnique: jest.fn() } } as any;
    const ingestion = { resolutionOf: jest.fn().mockResolvedValue(resolution) } as any;
    const svc = new TabsService(prisma, ingestion);
    const out = await svc.getTab('p1', 'architecture');
    expect(out.source.level).toBe(4);
    expect(out.payload).toBeNull();
  });
});
