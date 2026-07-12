import { parseFrontmatter } from './frontmatter';

describe('parseFrontmatter', () => {
  it('marca conventional quando proplan: v1 está presente', () => {
    const md = '---\nproplan: v1\nupdated: 2026-07-12\n---\n# Título\n';
    const r = parseFrontmatter(md);
    expect(r.isConventional).toBe(true);
    expect(r.data).toEqual({ proplan: 'v1', updated: expect.anything() });
  });

  it('documento sem frontmatter é livre (não conventional)', () => {
    const r = parseFrontmatter('# Só um README\n\ntexto');
    expect(r.isConventional).toBe(false);
    expect(r.data).toBeNull();
  });

  it('frontmatter sem proplan é livre mas preserva os dados', () => {
    const md = '---\ntitle: Foo\n---\ncorpo';
    const r = parseFrontmatter(md);
    expect(r.isConventional).toBe(false);
    expect(r.data).toEqual({ title: 'Foo' });
  });

  it('proplan com outra versão não conta como v1', () => {
    const md = '---\nproplan: v2\n---\n';
    expect(parseFrontmatter(md).isConventional).toBe(false);
  });

  it('YAML malformado não lança — trata como documento livre', () => {
    const md = '---\nproplan: : : v1\n  bad\n---\ncorpo';
    const r = parseFrontmatter(md);
    expect(r.isConventional).toBe(false);
    expect(r.data).toBeNull();
  });
});
