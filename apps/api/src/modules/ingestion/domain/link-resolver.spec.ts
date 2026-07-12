import { resolveLink } from './link-resolver';

const scope = new Set([
  'README.md',
  'CLAUDE.md',
  'docs/ARCHITECTURE.md',
  'docs/DESIGN.md',
  'docs/specs/SPEC-001.md',
]);

const md = (target: string, anchor: string | null = null) => ({
  target,
  anchor,
  wiki: false,
});
const wiki = (target: string) => ({ target, anchor: null, wiki: true });

describe('resolveLink', () => {
  it('resolve relativo à pasta do source', () => {
    // de docs/ARCHITECTURE.md → ./DESIGN.md
    const r = resolveLink(md('./DESIGN.md'), 'docs/ARCHITECTURE.md', scope);
    expect(r.resolvedPath).toBe('docs/DESIGN.md');
  });

  it('resolve subir de pasta com ..', () => {
    // de docs/specs/SPEC-001.md → ../ARCHITECTURE.md
    const r = resolveLink(
      md('../ARCHITECTURE.md'),
      'docs/specs/SPEC-001.md',
      scope,
    );
    expect(r.resolvedPath).toBe('docs/ARCHITECTURE.md');
  });

  it('resolve da raiz (README) para docs/', () => {
    const r = resolveLink(md('docs/ARCHITECTURE.md'), 'README.md', scope);
    expect(r.resolvedPath).toBe('docs/ARCHITECTURE.md');
  });

  it('alvo inexistente → quebrado (resolvedPath null) mas mantém targetPath', () => {
    const r = resolveLink(md('./GONE.md'), 'docs/ARCHITECTURE.md', scope);
    expect(r.resolvedPath).toBeNull();
    expect(r.targetPath).toBe('docs/GONE.md');
  });

  it('wikilink resolve por basename case-insensitive + .md', () => {
    expect(resolveLink(wiki('architecture'), 'README.md', scope).resolvedPath).toBe(
      'docs/ARCHITECTURE.md',
    );
    expect(resolveLink(wiki('DESIGN'), 'README.md', scope).resolvedPath).toBe(
      'docs/DESIGN.md',
    );
  });

  it('wikilink inexistente → quebrado', () => {
    const r = resolveLink(wiki('NAOEXISTE'), 'README.md', scope);
    expect(r.resolvedPath).toBeNull();
    expect(r.targetPath).toBe('NAOEXISTE.md');
  });

  it('preserva âncora como metadado', () => {
    const r = resolveLink(
      md('./DESIGN.md', 'tokens'),
      'docs/ARCHITECTURE.md',
      scope,
    );
    expect(r.anchor).toBe('tokens');
    expect(r.resolvedPath).toBe('docs/DESIGN.md');
  });

  it('link absoluto da raiz do repo (/docs/..)', () => {
    const r = resolveLink(md('/docs/DESIGN.md'), 'docs/specs/SPEC-001.md', scope);
    expect(r.resolvedPath).toBe('docs/DESIGN.md');
  });
});
