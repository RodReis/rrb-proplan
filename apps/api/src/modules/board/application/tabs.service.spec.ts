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

describe('TabsService.getTab — decisions/testing/deploy/skills', () => {
  it('decisions: coleção → items', async () => {
    const resolution = { entity: 'decisions', level: 2, source: 'alias', path: null, paths: ['adr/0001-x.md'], confidence: 0.8 };
    const prisma = {
      document: { findMany: jest.fn().mockResolvedValue([{ path: 'adr/0001-x.md', content: '# Título X' }]) },
    } as any;
    const ingestion = { resolutionOf: jest.fn().mockResolvedValue(resolution) } as any;
    const out = await new TabsService(prisma, ingestion).getTab('p1', 'decisions');
    expect((out.payload as any).items[0].title).toBe('Título X');
  });

  it('testing: sem doc mas com workflows → ci inferido', async () => {
    const resolution = { entity: 'testing', level: 4, source: 'absent', path: null, paths: [], confidence: 0 };
    const prisma = {
      document: {
        findMany: jest.fn().mockResolvedValue([
          { path: '.github/workflows/ci.yml', content: 'name: CI\non: push\njobs:\n  b:\n    runs-on: ubuntu-latest\n' },
        ]),
      },
    } as any;
    const ingestion = { resolutionOf: jest.fn().mockResolvedValue(resolution) } as any;
    const out = await new TabsService(prisma, ingestion).getTab('p1', 'testing');
    expect((out.payload as any).inferred).toBe(true);
    expect((out.payload as any).ci.workflows[0].name).toBe('CI');
    expect(out.source.level).toBe(4); // resolução ainda é ausente; payload é fallback
  });

  it('deploy: ausente e sem CI → payload null (nunca IA)', async () => {
    const resolution = { entity: 'deploy', level: 4, source: 'absent', path: null, paths: [], confidence: 0 };
    const prisma = { document: { findUnique: jest.fn(), findMany: jest.fn() } } as any;
    const ingestion = { resolutionOf: jest.fn().mockResolvedValue(resolution) } as any;
    const out = await new TabsService(prisma, ingestion).getTab('p1', 'deploy');
    expect(out.payload).toBeNull();
  });
});
