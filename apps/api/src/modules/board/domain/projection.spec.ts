import {
  generateProjection,
  PROJECTION_HEADER,
  ProjectionCard,
} from './projection';
import {
  isGeneratedProjection,
  parseStatusMarkdown,
} from './status-parser';

const card = (over: Partial<ProjectionCard>): ProjectionCard => ({
  number: 1,
  title: 'Card',
  priority: null,
  column: 'backlog',
  closedAt: null,
  ...over,
});

describe('generateProjection', () => {
  it('inclui o cabeçalho obrigatório de artefato gerado', () => {
    const md = generateProjection([], '2026-07-12');
    expect(md).toContain(PROJECTION_HEADER);
    expect(md).toContain('proplan: v1');
    expect(md).toContain('# Status');
  });

  it('todas as 5 colunas aparecem, vazias com _(vazio)_', () => {
    const md = generateProjection([], '2026-07-12');
    for (const h of ['## Backlog', '## A Fazer', '## Em Andamento', '## Feito', '## Descartado']) {
      expect(md).toContain(h);
    }
    expect(md).toContain('_(vazio)_');
  });

  it('card carrega número e prioridade', () => {
    const md = generateProjection(
      [card({ number: 42, title: 'Tela de config', priority: 'alta', column: 'todo' })],
      '2026-07-12',
    );
    expect(md).toContain('- Tela de config (#42, prio: alta)');
  });

  it('Feito usa "fechado em" com a data real; Descartado usa "descartado em"', () => {
    const md = generateProjection(
      [
        card({ number: 12, title: 'Setup', column: 'done', closedAt: new Date('2026-06-20T10:00:00Z') }),
        card({ number: 27, title: 'GraphQL', column: 'discarded', closedAt: new Date('2026-07-02T10:00:00Z') }),
      ],
      '2026-07-12',
    );
    expect(md).toContain('- Setup (#12, fechado em: 2026-06-20)');
    expect(md).toContain('- GraphQL (#27, descartado em: 2026-07-02)');
  });
});

describe('isGeneratedProjection', () => {
  it('detecta o cabeçalho de projeção', () => {
    expect(isGeneratedProjection(generateProjection([], '2026-07-12'))).toBe(true);
    expect(isGeneratedProjection('# Status\n## Backlog\n- item')).toBe(false);
  });
});

describe('parseStatusMarkdown', () => {
  it('round-trip: gerar → parsear devolve os mesmos cards', () => {
    const cards = [
      card({ number: 42, title: 'Tela de config', priority: 'alta', column: 'todo' }),
      card({ number: 41, title: 'OAuth', column: 'doing' }),
    ];
    const parsed = parseStatusMarkdown(generateProjection(cards, '2026-07-12'));
    expect(parsed).toEqual([
      { title: 'Tela de config', column: 'todo', priority: 'alta', number: 42 },
      { title: 'OAuth', column: 'doing', priority: null, number: 41 },
    ]);
  });

  it('legado sem #número: importa título e coluna, number null', () => {
    const legacy = `# Roadmap
## A Fazer
- Implementar login
- Exportar PDF

## Feito
- Setup inicial`;
    expect(parseStatusMarkdown(legacy)).toEqual([
      { title: 'Implementar login', column: 'todo', priority: null, number: null },
      { title: 'Exportar PDF', column: 'todo', priority: null, number: null },
      { title: 'Setup inicial', column: 'done', priority: null, number: null },
    ]);
  });

  it('aceita variações de nome de seção (To Do, In Progress, Cancelado)', () => {
    const md = `## To Do\n- A\n## In Progress\n- B\n## Cancelado\n- C`;
    const cols = parseStatusMarkdown(md).map((c) => c.column);
    expect(cols).toEqual(['todo', 'doing', 'discarded']);
  });

  it('ignora seções não reconhecidas (não inventa coluna)', () => {
    const md = `## Notas\n- não é card\n## Backlog\n- é card`;
    expect(parseStatusMarkdown(md)).toEqual([
      { title: 'é card', column: 'backlog', priority: null, number: null },
    ]);
  });

  it('ignora o placeholder _(vazio)_', () => {
    expect(parseStatusMarkdown('## Backlog\n\n_(vazio)_')).toEqual([]);
  });
});
