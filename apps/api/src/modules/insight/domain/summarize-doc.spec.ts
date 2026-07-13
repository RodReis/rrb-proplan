import { summarizeDoc } from './summarize-doc';

describe('summarizeDoc', () => {
  it('extrai título (primeira linha "# "), headings ("## ") e excerpt', () => {
    const content = '# Título\n\nTexto intro.\n\n## Seção 1\nconteúdo\n\n## Seção 2\nmais conteúdo';
    const result = summarizeDoc(content);
    expect(result.title).toBe('Título');
    expect(result.headings).toEqual(['Seção 1', 'Seção 2']);
    expect(result.excerpt).toContain('Texto intro.');
  });

  it('sem título nem headings → title vazio e headings vazio, sem lançar', () => {
    const content = 'linha solta sem cabeçalho';
    const result = summarizeDoc(content);
    expect(result.title).toBe('');
    expect(result.headings).toEqual([]);
    expect(result.excerpt).toContain('linha solta sem cabeçalho');
  });
});
