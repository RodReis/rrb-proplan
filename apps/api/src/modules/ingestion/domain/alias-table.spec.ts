import { matchAlias } from './alias-table';

describe('matchAlias', () => {
  it('casa nome exato sem extensão, case- e acento-insensitive', () => {
    expect(matchAlias('docs/arquitetura.md')).toBe('architecture');
    expect(matchAlias('ARCHITECTURE.md')).toBe('architecture');
    expect(matchAlias('docs/Arch.markdown')).toBe('architecture');
    expect(matchAlias('docs/DESIGN.md')).toBe('design');
    expect(matchAlias('docs/qa.md')).toBe('testing');
  });

  it('casa diretório de alias (coleção)', () => {
    expect(matchAlias('adr/0001-x.md')).toBe('decisions');
    expect(matchAlias('docs/adr/0002-y.md')).toBe('decisions');
    expect(matchAlias('docs/qa/estrategia.md')).toBe('testing');
    expect(matchAlias('.claude/skills/x/SKILL.md')).toBe('skills');
  });

  it('NÃO é ganancioso: archive ≠ arch', () => {
    expect(matchAlias('docs/archive/notas.md')).toBeNull();
    expect(matchAlias('docs/architecture-decisions-old/x.md')).toBeNull();
    expect(matchAlias('src/deployment-notes.txt')).toBeNull();
  });

  it('retorna null para arquivo sem alias', () => {
    expect(matchAlias('docs/random.md')).toBeNull();
    expect(matchAlias('README.md')).toBeNull();
  });

  it('CLAUDE.md e AGENTS.md casam skills', () => {
    expect(matchAlias('CLAUDE.md')).toBe('skills');
    expect(matchAlias('AGENTS.md')).toBe('skills');
  });
});
