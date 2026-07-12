import { isInScope } from './scope-filter';

describe('isInScope', () => {
  it('inclui README.md e CLAUDE.md na raiz', () => {
    expect(isInScope('README.md')).toBe(true);
    expect(isInScope('CLAUDE.md')).toBe(true);
  });

  it('inclui docs/ recursivo (subpastas)', () => {
    expect(isInScope('docs/ARCHITECTURE.md')).toBe(true);
    expect(isInScope('docs/specs/SPEC-002.md')).toBe(true);
  });

  it('exclui código e READMEs fora da raiz', () => {
    expect(isInScope('src/main.ts')).toBe(false);
    expect(isInScope('packages/x/README.md')).toBe(false);
    expect(isInScope('CLAUDE.md.bak')).toBe(false);
  });

  it('exclui .claude e workflows (só na Fatia 6)', () => {
    expect(isInScope('.claude/skills/x.md')).toBe(false);
    expect(isInScope('.github/workflows/ci.yml')).toBe(false);
  });
});
