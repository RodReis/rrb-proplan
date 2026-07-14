import { buildFeed } from './activity-feed';

const d = (iso: string) => new Date(iso);

describe('buildFeed — projeção do histórico de Atividade', () => {
  it('unifica as 4 fontes em ordem reversa por data', () => {
    const feed = buildFeed({
      operations: [
        { id: 'o1', kind: 'promote', status: 'done', commitUrl: 'http://c/1', startedAt: d('2026-07-13T10:00:00Z') },
      ],
      insights: [
        { id: 'i1', kind: 'architecture_fallback', provider: 'anthropic', model: 'claude-sonnet-5', createdAt: d('2026-07-13T09:00:00Z'), content: {} },
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
      insights: [],
      mutations: [],
      syncs: [], // toggle desligado → service não passa syncs
    });
    expect(feed).toHaveLength(1);
    expect(feed[0].kind).toBe('operation');
  });

  it('com syncs (toggle ligado), o noop aparece', () => {
    const feed = buildFeed({
      operations: [],
      insights: [],
      mutations: [],
      syncs: [{ id: 's1', status: 'noop', added: 0, updated: 0, removed: 0, startedAt: d('2026-07-13T10:00:00Z') }],
    });
    expect(feed).toHaveLength(1);
    expect(feed[0].title).toContain('nada mudou');
  });

  it('operation: título por kind + link do commit como evidência', () => {
    const [item] = buildFeed({
      operations: [{ id: 'o1', kind: 'promote', status: 'done', commitUrl: 'http://commit', startedAt: d('2026-07-13T10:00:00Z') }],
      insights: [], mutations: [], syncs: [],
    });
    expect(item.title).toBe('Promoveu um documento inferido a fonte');
    expect(item.evidenceUrl).toBe('http://commit');
  });

  it('board_mutation move_column: título com número e coluna + link da issue', () => {
    const [item] = buildFeed({
      operations: [], insights: [],
      mutations: [{ id: 'm1', type: 'move_column', payload: { number: 7, toColumn: 'done' }, status: 'applied', createdAt: d('2026-07-13T10:00:00Z'), issueUrl: 'http://i/7' }],
      syncs: [],
    });
    expect(item.title).toBe('Moveu a issue #7 para Feito');
    expect(item.evidenceUrl).toBe('http://i/7');
  });

  it('move_column traduz o valor do enum para o nome de exibição (nunca "todo"/"finalized")', () => {
    const mk = (toColumn: string) =>
      buildFeed({
        operations: [], insights: [], syncs: [],
        mutations: [{ id: 'm', type: 'move_column', payload: { number: 1, toColumn }, status: 'applied', createdAt: d('2026-07-13T10:00:00Z'), issueUrl: null }],
      })[0].title;
    expect(mk('todo')).toBe('Moveu a issue #1 para A Fazer');
    expect(mk('doing')).toBe('Moveu a issue #1 para Em Andamento');
    expect(mk('finalized')).toBe('Moveu a issue #1 para Finalizado');
  });

  it('insight: mostra provider/model no detalhe, sem link', () => {
    const [item] = buildFeed({
      operations: [], mutations: [], syncs: [],
      insights: [{ id: 'i1', kind: 'summary', provider: 'anthropic', model: 'x', createdAt: d('2026-07-13T10:00:00Z'), content: {} }],
    });
    expect(item.detail).toBe('anthropic/x');
    expect(item.evidenceUrl).toBeNull();
  });

  it('resultado por linha: classify mostra nº de documentos do content (hits)', () => {
    const mk = (content: unknown) =>
      buildFeed({
        operations: [], mutations: [], syncs: [],
        insights: [{ id: 'i', kind: 'classify_marker', provider: 'a', model: 'classify', createdAt: d('2026-07-13T10:00:00Z'), content }],
      })[0].title;
    expect(mk({ hits: [{}, {}, {}] })).toBe('Classificou 3 documentos por IA');
    expect(mk({ hits: [{}] })).toBe('Classificou 1 documento por IA'); // singular
    expect(mk({})).toBe('Classificou documentos por IA'); // sem contagem → texto neutro
  });

  it('resultado por linha: edges mostra nº de ligações do content (count)', () => {
    const mk = (content: unknown) =>
      buildFeed({
        operations: [], mutations: [], syncs: [],
        insights: [{ id: 'i', kind: 'edges_marker', provider: 'a', model: 'edges', createdAt: d('2026-07-13T10:00:00Z'), content }],
      })[0].title;
    expect(mk({ count: 14 })).toBe('Inferiu 14 ligações entre documentos por IA');
    expect(mk({ count: 1 })).toBe('Inferiu 1 ligação entre documentos por IA'); // singular
    expect(mk({})).toBe('Inferiu ligações entre documentos por IA'); // legado sem count
  });

  it('nenhum título tem jargão técnico', () => {
    const feed = buildFeed({
      operations: [{ id: 'o1', kind: 'mapping', status: 'done', commitUrl: null, startedAt: d('2026-07-13T10:00:00Z') }],
      insights: [{ id: 'i1', kind: 'edges_marker', provider: 'a', model: 'm', createdAt: d('2026-07-13T09:00:00Z'), content: { count: 3 } }],
      mutations: [],
      syncs: [{ id: 's1', status: 'success', added: 1, updated: 0, removed: 0, startedAt: d('2026-07-13T08:00:00Z') }],
    });
    const text = feed.map((f) => f.title + ' ' + (f.detail ?? '')).join(' ');
    expect(text).not.toMatch(/docsTreeSha|enqueueSync|noop|blobSha|202/i);
  });
});
