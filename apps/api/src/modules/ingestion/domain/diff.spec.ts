import { diffScope } from './diff';

describe('diffScope', () => {
  it('classifica added, updated e removed', () => {
    const remote = [
      { path: 'README.md', blobSha: 'new' }, // updated (sha mudou)
      { path: 'docs/NEW.md', blobSha: 'x' }, // added
      { path: 'CLAUDE.md', blobSha: 'same' }, // inalterado
    ];
    const local = new Map([
      ['README.md', 'old'],
      ['CLAUDE.md', 'same'],
      ['docs/GONE.md', 'y'], // removed (sumiu do remoto)
    ]);

    const { added, updated, removed } = diffScope(remote, local);

    expect(added.map((e) => e.path)).toEqual(['docs/NEW.md']);
    expect(updated.map((e) => e.path)).toEqual(['README.md']);
    expect(removed).toEqual(['docs/GONE.md']);
  });

  it('tudo novo quando local está vazio', () => {
    const remote = [{ path: 'README.md', blobSha: 'a' }];
    const { added, updated, removed } = diffScope(remote, new Map());
    expect(added).toHaveLength(1);
    expect(updated).toHaveLength(0);
    expect(removed).toHaveLength(0);
  });

  it('nenhuma mudança quando remoto == local', () => {
    const remote = [{ path: 'README.md', blobSha: 'a' }];
    const local = new Map([['README.md', 'a']]);
    const { added, updated, removed } = diffScope(remote, local);
    expect(added).toHaveLength(0);
    expect(updated).toHaveLength(0);
    expect(removed).toHaveLength(0);
  });

  it('remoto vazio remove tudo que era local', () => {
    const local = new Map([['README.md', 'a']]);
    const { removed } = diffScope([], local);
    expect(removed).toEqual(['README.md']);
  });
});
