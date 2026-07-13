/** Diretórios de alias na raiz (repos que não usam docs/). */
const ROOT_ALIAS_DIRS = ['adr/', 'adrs/', 'decisions/', 'decisoes/'];
/** Arquivos de alias soltos na raiz. */
const ROOT_ALIAS_FILES = new Set([
  'README.md',
  'CLAUDE.md',
  'AGENTS.md',
  'CONTRIBUTING.md',
  'RUNBOOK.md',
  'ROADMAP.md',
  'TODO.md',
]);

/**
 * Escopo de ingestão (ADR-003, ampliado na Fatia 6/ADR-014): docs/**, arquivos
 * e diretórios de alias na raiz, .proplan/config.yml, .claude fino (skills/agents)
 * e workflows do CI. Match sobre o path POSIX completo, sem barra inicial.
 */
export function isInScope(path: string): boolean {
  if (ROOT_ALIAS_FILES.has(path)) return true;
  if (path === '.proplan/config.yml') return true;
  if (path.startsWith('docs/')) return true;
  if (ROOT_ALIAS_DIRS.some((d) => path.startsWith(d))) return true;
  // .claude fino: só índices de skills e agents (evita settings/hooks).
  if (/^\.claude\/skills\/[^/]+\/SKILL\.md$/.test(path)) return true;
  if (/^\.claude\/agents\/[^/]+\.md$/.test(path)) return true;
  // Workflows do CI (fallback de Testes).
  if (/^\.github\/workflows\/[^/]+\.ya?ml$/.test(path)) return true;
  return false;
}
