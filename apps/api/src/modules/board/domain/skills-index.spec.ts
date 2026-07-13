import { parseSkills } from './skills-index';

describe('parseSkills', () => {
  it('separa skills e agents pelo path, lê name/description do frontmatter', () => {
    const out = parseSkills([
      { path: '.claude/skills/foo/SKILL.md', content: '---\nname: foo\ndescription: faz foo\n---\n# Foo' },
      { path: '.claude/agents/bar.md', content: '---\nname: bar\ndescription: agente bar\n---\n' },
      { path: 'CLAUDE.md', content: '# Regras' },
    ]);
    expect(out.skills).toEqual([{ name: 'foo', description: 'faz foo', path: '.claude/skills/foo/SKILL.md' }]);
    expect(out.agents).toEqual([{ name: 'bar', description: 'agente bar', path: '.claude/agents/bar.md' }]);
  });

  it('sem frontmatter → name do basename, description null', () => {
    const out = parseSkills([{ path: '.claude/skills/x/SKILL.md', content: '# só título' }]);
    expect(out.skills[0].name).toBe('x');
    expect(out.skills[0].description).toBeNull();
  });
});
