import { estimateTokens, selectContext } from './context-budget';

const doc = (path: string, chars: number) => ({
  path,
  content: 'x'.repeat(chars),
});

describe('selectContext', () => {
  it('prioriza README > CLAUDE > STATUS > demais', () => {
    const docs = [
      doc('docs/OUTRO.md', 40),
      doc('docs/STATUS.md', 40),
      doc('CLAUDE.md', 40),
      doc('README.md', 40),
    ];
    const sel = selectContext(docs, 1000);
    expect(sel.map((d) => d.path)).toEqual([
      'README.md',
      'CLAUDE.md',
      'docs/STATUS.md',
      'docs/OUTRO.md',
    ]);
  });

  it('trunca o próximo doc no espaço restante em vez de omitir', () => {
    // README ~25 tokens (100 chars) cabe no teto 30; sobram 5 → CLAUDE truncado
    const docs = [doc('README.md', 100), doc('CLAUDE.md', 100)];
    const sel = selectContext(docs, 30);
    expect(sel).toHaveLength(2);
    expect(sel[0].content).not.toContain('truncado');
    expect(sel[1].content).toContain('[...truncado...]');
  });

  it('omite docs quando o teto já foi totalmente consumido', () => {
    // README preenche exatamente o teto (40 chars = 10 tokens); CLAUDE fica de fora
    const docs = [doc('README.md', 40), doc('CLAUDE.md', 40)];
    const sel = selectContext(docs, 10);
    expect(sel).toHaveLength(1);
    expect(sel[0].path).toBe('README.md');
  });

  it('trunca o doc prioritário quando ele sozinho estoura', () => {
    const docs = [doc('README.md', 1000)]; // 250 tokens
    const sel = selectContext(docs, 50); // cabe ~200 chars
    expect(sel).toHaveLength(1);
    expect(sel[0].content).toContain('[...truncado...]');
    expect(sel[0].content.length).toBeLessThan(1000);
  });

  it('desempata por ordem alfabética no mesmo nível', () => {
    const sel = selectContext(
      [doc('docs/b.md', 4), doc('docs/a.md', 4)],
      1000,
    );
    expect(sel.map((d) => d.path)).toEqual(['docs/a.md', 'docs/b.md']);
  });

  it('lista vazia devolve vazio', () => {
    expect(selectContext([], 1000)).toEqual([]);
  });

  it('estimateTokens ~ chars/4', () => {
    expect(estimateTokens('12345678')).toBe(2);
  });
});
