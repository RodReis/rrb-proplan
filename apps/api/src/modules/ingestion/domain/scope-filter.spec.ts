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

  it('Fatia 6: inclui .proplan/config.yml, .claude e workflows', () => {
    expect(isInScope('.proplan/config.yml')).toBe(true);
    expect(isInScope('.claude/skills/x/SKILL.md')).toBe(true);
    expect(isInScope('.claude/agents/y.md')).toBe(true);
    expect(isInScope('.github/workflows/ci.yml')).toBe(true);
    expect(isInScope('.github/workflows/ci.yaml')).toBe(true);
  });

  it('Fatia 6: inclui diretórios de alias na raiz e alias soltos', () => {
    expect(isInScope('adr/0001-x.md')).toBe(true);
    expect(isInScope('decisions/0001.md')).toBe(true);
    expect(isInScope('AGENTS.md')).toBe(true);
    expect(isInScope('CONTRIBUTING.md')).toBe(true);
  });

  it('Fatia 6: exclui ruído de .claude e .github fora do escopo fino', () => {
    expect(isInScope('.claude/settings.json')).toBe(false);
    expect(isInScope('.github/ISSUE_TEMPLATE/bug.md')).toBe(false);
    expect(isInScope('.proplan/STATUS.md')).toBe(false); // artefato gerado, não fonte
  });
});
