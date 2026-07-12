import { computeScopeHash } from './scope-hash';

describe('computeScopeHash', () => {
  it('é determinístico independentemente da ordem de entrada', () => {
    const a = computeScopeHash([
      { path: 'README.md', blobSha: 'aaa' },
      { path: 'docs/ARCHITECTURE.md', blobSha: 'bbb' },
    ]);
    const b = computeScopeHash([
      { path: 'docs/ARCHITECTURE.md', blobSha: 'bbb' },
      { path: 'README.md', blobSha: 'aaa' },
    ]);
    expect(a).toBe(b);
  });

  it('muda quando um blobSha muda', () => {
    const before = computeScopeHash([{ path: 'README.md', blobSha: 'aaa' }]);
    const after = computeScopeHash([{ path: 'README.md', blobSha: 'zzz' }]);
    expect(before).not.toBe(after);
  });

  it('muda quando um documento é adicionado', () => {
    const one = computeScopeHash([{ path: 'README.md', blobSha: 'aaa' }]);
    const two = computeScopeHash([
      { path: 'README.md', blobSha: 'aaa' },
      { path: 'CLAUDE.md', blobSha: 'ccc' },
    ]);
    expect(one).not.toBe(two);
  });

  it('escopo vazio produz hash estável', () => {
    expect(computeScopeHash([])).toBe(computeScopeHash([]));
  });

  it('não colide path+sha concatenados com separadores (aa|a vs a|aa)', () => {
    const x = computeScopeHash([{ path: 'aa', blobSha: 'a' }]);
    const y = computeScopeHash([{ path: 'a', blobSha: 'aa' }]);
    expect(x).not.toBe(y);
  });
});
