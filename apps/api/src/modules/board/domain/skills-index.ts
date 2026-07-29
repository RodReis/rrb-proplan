import matter from 'gray-matter';

export interface SkillEntry {
  name: string;
  description: string | null;
  path: string;
}

function parseEntry(doc: { path: string; content: string }, nameFromDir: boolean): SkillEntry {
  let data: Record<string, unknown>;
  try {
    data = matter(doc.content).data as Record<string, unknown>;
  } catch {
    data = {};
  }
  const fallback = nameFromDir
    ? (doc.path.split('/').slice(-2, -1)[0] ?? doc.path) // .../<nome>/SKILL.md
    : (doc.path.split('/').pop() ?? doc.path).replace(/\.md$/, '');
  return {
    name: typeof data.name === 'string' ? data.name : fallback,
    description: typeof data.description === 'string' ? data.description : null,
    path: doc.path,
  };
}

/** Índice determinístico de skills e agents (sem IA). CLAUDE.md sozinho não gera
 *  entradas (é regra, não skill) — mas indica que há configuração. */
export function parseSkills(docs: { path: string; content: string }[]): {
  skills: SkillEntry[];
  agents: SkillEntry[];
} {
  const skills = docs
    .filter((d) => /\.claude\/skills\/[^/]+\/SKILL\.md$/.test(d.path))
    .map((d) => parseEntry(d, true));
  const agents = docs
    .filter((d) => /\.claude\/agents\/[^/]+\.md$/.test(d.path))
    .map((d) => parseEntry(d, false));
  return { skills, agents };
}
