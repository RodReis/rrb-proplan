import { TabsService } from './tabs.service';

describe('TabsService.getTab — architecture', () => {
  it('resolvida → markdown do doc', async () => {
    const resolution = { entity: 'architecture', level: 1, source: 'convention', path: 'docs/ARCHITECTURE.md', paths: [], confidence: 1 };
    const prisma = {
      document: { findUnique: jest.fn().mockResolvedValue({ content: '# Arquitetura' }) },
    } as any;
    const ingestion = { resolutionOf: jest.fn().mockResolvedValue(resolution) } as any;
    const insight = { latestClassifySpans: jest.fn() } as any;
    const svc = new TabsService(prisma, ingestion, insight);
    const out = await svc.getTab('p1', 'architecture');
    expect(out.source.level).toBe(1);
    expect(out.payload).toEqual({ markdown: '# Arquitetura' });
    expect(insight.latestClassifySpans).not.toHaveBeenCalled();
  });

  it('ausente → payload null', async () => {
    const resolution = { entity: 'architecture', level: 4, source: 'absent', path: null, paths: [], confidence: 0 };
    const prisma = { document: { findUnique: jest.fn() } } as any;
    const ingestion = { resolutionOf: jest.fn().mockResolvedValue(resolution) } as any;
    const insight = { latestClassifySpans: jest.fn() } as any;
    const svc = new TabsService(prisma, ingestion, insight);
    const out = await svc.getTab('p1', 'architecture');
    expect(out.source.level).toBe(4);
    expect(out.payload).toBeNull();
  });

  it('nível 3 (inference) → markdown + inferred:true + spans do InsightService', async () => {
    const resolution = { entity: 'architecture', level: 3, source: 'inference', path: 'docs/tech.md', paths: [], confidence: 0.7 };
    const prisma = {
      document: { findUnique: jest.fn().mockResolvedValue({ content: '# Tech' }) },
    } as any;
    const ingestion = { resolutionOf: jest.fn().mockResolvedValue(resolution) } as any;
    const insight = { latestClassifySpans: jest.fn().mockResolvedValue(['trecho A']) } as any;
    const svc = new TabsService(prisma, ingestion, insight);
    const out = await svc.getTab('p1', 'architecture');
    expect(out.source.level).toBe(3);
    expect(out.source.source).toBe('inference');
    expect(out.payload).toEqual({ markdown: '# Tech', inferred: true, spans: ['trecho A'] });
    expect(insight.latestClassifySpans).toHaveBeenCalledWith('p1', 'architecture');
  });
});

describe('TabsService.getTab — decisions/testing/deploy/skills', () => {
  it('decisions: coleção → items', async () => {
    const resolution = { entity: 'decisions', level: 2, source: 'alias', path: null, paths: ['adr/0001-x.md'], confidence: 0.8 };
    const prisma = {
      document: { findMany: jest.fn().mockResolvedValue([{ path: 'adr/0001-x.md', content: '# Título X' }]) },
    } as any;
    const ingestion = { resolutionOf: jest.fn().mockResolvedValue(resolution) } as any;
    const insight = { latestClassifySpans: jest.fn() } as any;
    const out = await new TabsService(prisma, ingestion, insight).getTab('p1', 'decisions');
    expect((out.payload as any).items[0].title).toBe('Título X');
    expect((out.payload as any).inferred).toBeUndefined();
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
    const insight = { latestClassifySpans: jest.fn() } as any;
    const out = await new TabsService(prisma, ingestion, insight).getTab('p1', 'testing');
    expect((out.payload as any).inferred).toBe(true);
    expect((out.payload as any).ci.workflows[0].name).toBe('CI');
    expect(out.source.level).toBe(4); // resolução ainda é ausente; payload é fallback
  });

  it('deploy: ausente e sem CI → payload null (nunca IA)', async () => {
    const resolution = { entity: 'deploy', level: 4, source: 'absent', path: null, paths: [], confidence: 0 };
    const prisma = { document: { findUnique: jest.fn(), findMany: jest.fn() } } as any;
    const ingestion = { resolutionOf: jest.fn().mockResolvedValue(resolution) } as any;
    const insight = { latestClassifySpans: jest.fn() } as any;
    const out = await new TabsService(prisma, ingestion, insight).getTab('p1', 'deploy');
    expect(out.payload).toBeNull();
  });
});
