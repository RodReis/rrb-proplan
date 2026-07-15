import { TabsService } from './tabs.service';

describe('TabsService.getTab — architecture', () => {
  it('resolvida → markdown do doc', async () => {
    const resolution = { entity: 'architecture', level: 1, source: 'convention', path: 'docs/ARCHITECTURE.md', paths: [], confidence: 1 };
    const prisma = {
      document: { findUnique: jest.fn().mockResolvedValue({ content: '# Arquitetura' }) },
    } as any;
    const ingestion = { resolutionOf: jest.fn().mockResolvedValue(resolution) } as any;
    const insight = { latestClassifySpans: jest.fn(), latestFallbackInternal: jest.fn() } as any;
    const svc = new TabsService(prisma, ingestion, insight, {} as any, {} as any, {} as any, {} as any);
    const out = await svc.getTab('p1', 'architecture');
    expect(out.source.level).toBe(1);
    expect(out.payload).toEqual({ markdown: '# Arquitetura' });
    expect(insight.latestClassifySpans).not.toHaveBeenCalled();
  });

  it('ausente → payload null', async () => {
    const resolution = { entity: 'architecture', level: 4, source: 'absent', path: null, paths: [], confidence: 0 };
    const prisma = { document: { findUnique: jest.fn() } } as any;
    const ingestion = { resolutionOf: jest.fn().mockResolvedValue(resolution) } as any;
    const insight = { latestClassifySpans: jest.fn(), latestFallbackInternal: jest.fn().mockResolvedValue(null) } as any;
    const svc = new TabsService(prisma, ingestion, insight, {} as any, {} as any, {} as any, {} as any);
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
    const svc = new TabsService(prisma, ingestion, insight, {} as any, {} as any, {} as any, {} as any);
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
    const out = await new TabsService(prisma, ingestion, insight, {} as any, {} as any, {} as any, {} as any).getTab('p1', 'decisions');
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
    const out = await new TabsService(prisma, ingestion, insight, {} as any, {} as any, {} as any, {} as any).getTab('p1', 'testing');
    expect((out.payload as any).inferred).toBe(true);
    expect((out.payload as any).ci.workflows[0].name).toBe('CI');
    expect(out.source.level).toBe(4); // resolução ainda é ausente; payload é fallback
  });

  it('deploy: ausente, sem CI e sem drift → payload null (nunca IA)', async () => {
    const resolution = { entity: 'deploy', level: 4, source: 'absent', path: null, paths: [], confidence: 0 };
    const prisma = {
      document: { findUnique: jest.fn(), findMany: jest.fn() },
      project: { findUnique: jest.fn().mockResolvedValue({ deployVerdict: null, deploySignals: null, deployObservedAt: null }) },
    } as any;
    const ingestion = { resolutionOf: jest.fn().mockResolvedValue(resolution) } as any;
    const insight = { latestClassifySpans: jest.fn(), latestFallbackInternal: jest.fn().mockResolvedValue(null) } as any;
    const out = await new TabsService(prisma, ingestion, insight, {} as any, {} as any, {} as any, {} as any).getTab('p1', 'deploy');
    expect(out.payload).toBeNull();
  });

  // SPEC-012: o teste que prova a fatia — doc mapeado SEM a tabela do CONVENTION.md
  // → o markdown aparece e o painel de ambientes fica vazio (não some o doc).
  it('deploy: doc mapeado sem tabela → markdown não-vazio + environments []', async () => {
    const resolution = { entity: 'deploy', level: 2, source: 'config', path: 'docs/runbooks/deploy-railway.md', paths: [], confidence: 1 };
    const runbook = '# Deploy Railway\n\nSubir com `railway up`. Sem tabela de ambientes.';
    const prisma = {
      document: { findUnique: jest.fn().mockResolvedValue({ content: runbook }) },
      project: { findUnique: jest.fn().mockResolvedValue({ deployVerdict: null, deploySignals: null, deployObservedAt: null }) },
    } as any;
    const ingestion = { resolutionOf: jest.fn().mockResolvedValue(resolution) } as any;
    const insight = { latestClassifySpans: jest.fn() } as any;
    const out = await new TabsService(prisma, ingestion, insight, {} as any, {} as any, {} as any, {} as any).getTab('p1', 'deploy');
    expect((out.payload as any).environments).toEqual([]);
    expect((out.payload as any).markdown).toBe(runbook);
    expect((out.payload as any).path).toBe('docs/runbooks/deploy-railway.md');
  });

  it('deploy: doc COM a tabela → painel de ambientes E markdown juntos', async () => {
    const resolution = { entity: 'deploy', level: 1, source: 'convention', path: 'docs/DEPLOY.md', paths: [], confidence: 1 };
    const doc = '# Deploy\n\n| Ambiente | Status | Plataforma | URL |\n| prod | ativo | Railway | https://x |';
    const prisma = {
      document: { findUnique: jest.fn().mockResolvedValue({ content: doc }) },
      project: { findUnique: jest.fn().mockResolvedValue({ deployVerdict: null, deploySignals: null, deployObservedAt: null }) },
    } as any;
    const ingestion = { resolutionOf: jest.fn().mockResolvedValue(resolution) } as any;
    const insight = { latestClassifySpans: jest.fn() } as any;
    const out = await new TabsService(prisma, ingestion, insight, {} as any, {} as any, {} as any, {} as any).getTab('p1', 'deploy');
    expect((out.payload as any).environments.length).toBeGreaterThan(0);
    expect((out.payload as any).markdown).toBe(doc); // duplicação aceita (decisão do PI)
  });

  it('deploy: coleção (paths) → concatena os N docs, cada um sob seu heading', async () => {
    const resolution = { entity: 'deploy', level: 2, source: 'config', path: null, paths: ['docs/runbooks/a.md', 'docs/runbooks/b.md'], confidence: 1 };
    const prisma = {
      document: {
        findMany: jest.fn().mockResolvedValue([
          { path: 'docs/runbooks/b.md', content: 'conteúdo B' },
          { path: 'docs/runbooks/a.md', content: 'conteúdo A' },
        ]),
      },
      project: { findUnique: jest.fn().mockResolvedValue({ deployVerdict: null, deploySignals: null, deployObservedAt: null }) },
    } as any;
    const ingestion = { resolutionOf: jest.fn().mockResolvedValue(resolution) } as any;
    const insight = { latestClassifySpans: jest.fn() } as any;
    const out = await new TabsService(prisma, ingestion, insight, {} as any, {} as any, {} as any, {} as any).getTab('p1', 'deploy');
    const md = (out.payload as any).markdown as string;
    // ordem preservada de `paths` (a > b), cada doc sob seu heading
    expect(md).toContain('## docs/runbooks/a.md');
    expect(md).toContain('conteúdo A');
    expect(md).toContain('## docs/runbooks/b.md');
    expect(md.indexOf('a.md')).toBeLessThan(md.indexOf('b.md'));
  });

  // SPEC-013: o payload carrega o veredito de drift persistido (aditivo).
  it('deploy: expõe deployVerdict/deploySignals persistidos no payload', async () => {
    const resolution = { entity: 'deploy', level: 4, source: 'absent', path: null, paths: [], confidence: 1 };
    const signals = [{ source: 'repoConfig', platforms: ['vercel'], observedAt: '2026-07-14T00:00:00Z', evidenceRef: 'vercel.json' }];
    const prisma = {
      document: { findUnique: jest.fn().mockResolvedValue(null), findMany: jest.fn().mockResolvedValue([]) },
      project: { findUnique: jest.fn().mockResolvedValue({ deployVerdict: 'so_github_side', deploySignals: signals, deployObservedAt: new Date('2026-07-14') }) },
    } as any;
    const ingestion = { resolutionOf: jest.fn().mockResolvedValue(resolution) } as any;
    const insight = { latestClassifySpans: jest.fn() } as any;
    const out = await new TabsService(prisma, ingestion, insight, {} as any, {} as any, {} as any, {} as any).getTab('p1', 'deploy');
    expect((out.payload as any).deployVerdict).toBe('so_github_side');
    expect((out.payload as any).deploySignals).toEqual(signals);
  });
});
