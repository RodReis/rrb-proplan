import { parseEdges } from './edges-prompt';

describe('parseEdges', () => {
  it('parseia array JSON de {sourcePath,targetPath,motivo}', () => {
    const text = '```json\n[{"sourcePath":"docs/a.md","targetPath":"docs/b.md","motivo":"ambos tratam de X"}]\n```';
    const edges = parseEdges(text);
    expect(edges).toEqual([{ sourcePath: 'docs/a.md', targetPath: 'docs/b.md', reason: 'ambos tratam de X' }]);
  });
  it('descarta itens sem os 3 campos', () => {
    const text = '[{"sourcePath":"a"},{"sourcePath":"docs/a.md","targetPath":"docs/b.md","motivo":"m"}]';
    expect(parseEdges(text)).toHaveLength(1);
  });
  it('descarta self-link (source==target)', () => {
    const text = '[{"sourcePath":"docs/a.md","targetPath":"docs/a.md","motivo":"m"}]';
    expect(parseEdges(text)).toHaveLength(0);
  });
  it('JSON malformado → lança (caller faz retry)', () => {
    expect(() => parseEdges('nao e json')).toThrow();
  });
});
