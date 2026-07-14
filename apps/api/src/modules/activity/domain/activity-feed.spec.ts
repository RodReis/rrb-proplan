import { buildFeed } from './activity-feed';

const d = (iso: string) => new Date(iso);

describe('buildFeed — projeção do histórico de Atividade', () => {
  it('unifica as 4 fontes em ordem reversa por data', () => {
    const feed = buildFeed({
      operations: [
        { id: 'o1', kind: 'promote', status: 'done', commitUrl: 'http://c/1', startedAt: d('2026-07-13T10:00:00Z') },
      ],
      insightRuns: [
        { id: 'i1', kind: 'architecture_fallback', outcome: 'generated', createdAt: d('2026-07-13T09:00:00Z') },
      ],
      mutations: [
        { id: 'm1', type: 'move_column', payload: { number: 42, toColumn: 'doing' }, status: 'applied', createdAt: d('2026-07-13T11:00:00Z'), issueUrl: 'http://i/42' },
      ],
      syncs: [],
    });

    expect(feed.map((f) => f.id)).toEqual(['bm:m1', 'op:o1', 'ai:i1']); // 11h, 10h, 9h
  });

  it('feed limpo por padrão: sem syncs, só escrita e inferência', () => {
    // Critério de aceite: 10 noop + 1 commit no banco → syncs vazio (o service
    // não busca syncs sem o toggle) → o feed mostra 1 item.
    const feed = buildFeed({
      operations: [{ id: 'o1', kind: 'promote', status: 'done', commitUrl: null, startedAt: d('2026-07-13T10:00:00Z') }],
      insightRuns: [],
      mutations: [],
      syncs: [], // toggle desligado → service não passa syncs
    });
    expect(feed).toHaveLength(1);
    expect(feed[0].kind).toBe('operation');
  });

  it('com syncs (toggle ligado), o noop aparece', () => {
    const feed = buildFeed({
      operations: [],
      insightRuns: [],
      mutations: [],
      syncs: [{ id: 's1', status: 'noop', added: 0, updated: 0, removed: 0, startedAt: d('2026-07-13T10:00:00Z') }],
    });
    expect(feed).toHaveLength(1);
    expect(feed[0].title).toContain('nada mudou');
  });

  it('operation: título por kind + link do commit como evidência', () => {
    const [item] = buildFeed({
      operations: [{ id: 'o1', kind: 'promote', status: 'done', commitUrl: 'http://commit', startedAt: d('2026-07-13T10:00:00Z') }],
      insightRuns: [], mutations: [], syncs: [],
    });
    expect(item.title).toBe('Promoveu um documento inferido a fonte');
    expect(item.evidenceUrl).toBe('http://commit');
  });

  it('board_mutation move_column: título com número e coluna + link da issue', () => {
    const [item] = buildFeed({
      operations: [], insightRuns: [],
      mutations: [{ id: 'm1', type: 'move_column', payload: { number: 7, toColumn: 'done' }, status: 'applied', createdAt: d('2026-07-13T10:00:00Z'), issueUrl: 'http://i/7' }],
      syncs: [],
    });
    expect(item.title).toBe('Moveu a issue #7 para Feito');
    expect(item.evidenceUrl).toBe('http://i/7');
  });

  it('move_column traduz o valor do enum para o nome de exibição (nunca "todo"/"finalized")', () => {
    const mk = (toColumn: string) =>
      buildFeed({
        operations: [], insightRuns: [], syncs: [],
        mutations: [{ id: 'm', type: 'move_column', payload: { number: 1, toColumn }, status: 'applied', createdAt: d('2026-07-13T10:00:00Z'), issueUrl: null }],
      })[0].title;
    expect(mk('todo')).toBe('Moveu a issue #1 para A Fazer');
    expect(mk('doing')).toBe('Moveu a issue #1 para Em Andamento');
    expect(mk('finalized')).toBe('Moveu a issue #1 para Finalizado');
  });

  // SPEC-011: a fonte do feed para IA é o InsightRun (execução), não o artefato.
  // O feed distingue gerado × reaproveitado — a economia da 7.7 fica visível.

  it('insight_run generated: "Gerou <objeto> por IA", sem link', () => {
    const [item] = buildFeed({
      operations: [], mutations: [], syncs: [],
      insightRuns: [{ id: 'i1', kind: 'summary', outcome: 'generated', createdAt: d('2026-07-13T10:00:00Z') }],
    });
    expect(item.kind).toBe('insight_run');
    expect(item.title).toBe('Gerou o resumo do projeto por IA');
    expect(item.evidenceUrl).toBeNull();
  });

  it('insight_run reused: mostra que reaproveitou sem custo (a economia da 7.7)', () => {
    const [item] = buildFeed({
      operations: [], mutations: [], syncs: [],
      insightRuns: [{ id: 'i1', kind: 'edges_marker', outcome: 'reused', createdAt: d('2026-07-13T10:00:00Z') }],
    });
    expect(item.title).toBe('Reaproveitou as ligações entre documentos — nada mudou desde a última vez');
    expect(item.detail).toBe('Sem chamar a IA (sem custo)');
  });

  it('insight_run failed: sinaliza a falha por objeto', () => {
    const [item] = buildFeed({
      operations: [], mutations: [], syncs: [],
      insightRuns: [{ id: 'i1', kind: 'design_fallback', outcome: 'failed', createdAt: d('2026-07-13T10:00:00Z') }],
    });
    expect(item.title).toBe('Falhou ao inferir o Design por IA');
  });

  it('insight_run generated: detalhe mostra docs lidos + tokens, SEM dinheiro (decisão do PI)', () => {
    const [item] = buildFeed({
      operations: [], mutations: [], syncs: [],
      insightRuns: [{
        id: 'i1', kind: 'edges_marker', outcome: 'generated', createdAt: d('2026-07-13T10:00:00Z'),
        docsRead: 29,
        cost: { inputTokens: 10900, outputTokens: 729, costUsd: '0.043635' },
      }],
    });
    expect(item.detail).toBe('leu 29 documentos · 10.900 tokens de entrada · 729 de saída');
    expect(item.detail).not.toMatch(/US\$|\$/); // o cifrão no feed assusta — vive na aba Uso de IA
    expect(item.cost).toEqual({ inputTokens: 10900, outputTokens: 729, costUsd: '0.043635' });
  });

  it('insight_run generated: 1 documento no singular', () => {
    const [item] = buildFeed({
      operations: [], mutations: [], syncs: [],
      insightRuns: [{ id: 'i1', kind: 'summary', outcome: 'generated', createdAt: d('2026-07-13T10:00:00Z'), docsRead: 1, cost: null }],
    });
    expect(item.detail).toBe('leu 1 documento');
  });

  it('insight_run generated: tokens aparecem mesmo sem preço cadastrado', () => {
    const [item] = buildFeed({
      operations: [], mutations: [], syncs: [],
      insightRuns: [{
        id: 'i1', kind: 'summary', outcome: 'generated', createdAt: d('2026-07-13T10:00:00Z'),
        docsRead: 5,
        cost: { inputTokens: 100, outputTokens: 50, costUsd: null },
      }],
    });
    expect(item.detail).toBe('leu 5 documentos · 100 tokens de entrada · 50 de saída');
  });

  it('insight_run reused: detalhe deixa explícito que não custou; sem cost', () => {
    const [item] = buildFeed({
      operations: [], mutations: [], syncs: [],
      insightRuns: [{ id: 'i1', kind: 'summary', outcome: 'reused', createdAt: d('2026-07-13T10:00:00Z'), cost: null }],
    });
    expect(item.detail).toBe('Sem chamar a IA (sem custo)');
    expect(item.cost).toBeNull();
  });

  it('cada kind tem um objeto em linguagem de gente', () => {
    const mk = (kind: string) =>
      buildFeed({
        operations: [], mutations: [], syncs: [],
        insightRuns: [{ id: 'i', kind, outcome: 'generated', createdAt: d('2026-07-13T10:00:00Z') }],
      })[0].title;
    expect(mk('summary')).toBe('Gerou o resumo do projeto por IA');
    expect(mk('edges_marker')).toBe('Gerou as ligações entre documentos por IA');
    expect(mk('classify_marker')).toBe('Gerou a classificação de documentos por IA');
    expect(mk('architecture_fallback')).toBe('Gerou a Arquitetura por IA');
    expect(mk('design_fallback')).toBe('Gerou o Design por IA');
  });

  it('nenhum título tem jargão técnico', () => {
    const feed = buildFeed({
      operations: [{ id: 'o1', kind: 'mapping', status: 'done', commitUrl: null, startedAt: d('2026-07-13T10:00:00Z') }],
      insightRuns: [{ id: 'i1', kind: 'edges_marker', outcome: 'generated', createdAt: d('2026-07-13T09:00:00Z') }],
      mutations: [],
      syncs: [{ id: 's1', status: 'success', added: 1, updated: 0, removed: 0, startedAt: d('2026-07-13T08:00:00Z') }],
    });
    const text = feed.map((f) => f.title + ' ' + (f.detail ?? '')).join(' ');
    expect(text).not.toMatch(/docsTreeSha|docsScopeHash|inputHash|enqueueSync|noop|blobSha|202/i);
  });
});
