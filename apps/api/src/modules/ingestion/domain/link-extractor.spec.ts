import { extractLinks } from './link-extractor';

describe('extractLinks', () => {
  it('extrai link markdown relativo', () => {
    const links = extractLinks('veja [arch](docs/ARCHITECTURE.md).');
    expect(links).toEqual([
      { target: 'docs/ARCHITECTURE.md', anchor: null, wiki: false },
    ]);
  });

  it('separa a âncora do path', () => {
    const links = extractLinks('[x](./SPEC-001.md#secao)');
    expect(links[0]).toEqual({
      target: './SPEC-001.md',
      anchor: 'secao',
      wiki: false,
    });
  });

  it('extrai wikilink e ignora label', () => {
    const links = extractLinks('ver [[ARCHITECTURE|arquitetura]] e [[DESIGN]]');
    expect(links).toEqual([
      { target: 'ARCHITECTURE', anchor: null, wiki: true },
      { target: 'DESIGN', anchor: null, wiki: true },
    ]);
  });

  it('ignora links externos e âncoras puras', () => {
    const md =
      '[site](https://x.com) [mail](mailto:a@b.c) [topo](#intro) [ok](y.md)';
    const links = extractLinks(md);
    expect(links).toEqual([{ target: 'y.md', anchor: null, wiki: false }]);
  });

  it('ignora título entre aspas no link', () => {
    const links = extractLinks('[x](a.md "título")');
    expect(links[0].target).toBe('a.md');
  });

  it('markdown sem links → vazio', () => {
    expect(extractLinks('# só texto\n\nsem link')).toEqual([]);
  });
});
