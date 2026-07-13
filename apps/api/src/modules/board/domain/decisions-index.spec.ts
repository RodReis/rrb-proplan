import { parseDecisions } from './decisions-index';

describe('parseDecisions', () => {
  it('arquivo único: fatia por ## e extrai título', () => {
    const content = `# Decisões\n\n## ADR-001 — Escolha do ORM\nStatus: aceito\n\n## ADR-002 — Filas\nStatus: proposto\n`;
    const items = parseDecisions([{ path: 'docs/DECISIONS.md', content }]);
    expect(items).toHaveLength(2);
    expect(items[0].title).toBe('ADR-001 — Escolha do ORM');
    expect(items[0].anchor).toBe('adr-001-—-escolha-do-orm');
    expect(items[0].path).toBe('docs/DECISIONS.md');
  });

  it('coleção: um item por arquivo, título do H1', () => {
    const items = parseDecisions([
      { path: 'adr/0001-orm.md', content: '# Escolha do ORM\n...' },
      { path: 'adr/0002-filas.md', content: '# Filas com BullMQ\n...' },
    ]);
    expect(items).toHaveLength(2);
    expect(items[0].title).toBe('Escolha do ORM');
    expect(items[0].anchor).toBeNull();
  });

  it('fallback de título quando não há H1: usa o basename', () => {
    const items = parseDecisions([{ path: 'adr/0003-x.md', content: 'sem título\n' }]);
    expect(items[0].title).toBe('0003-x');
  });
});
