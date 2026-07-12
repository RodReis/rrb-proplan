/**
 * Escopo de ingestão da Fatia 2 (ADR-003): `docs/**` completo, `README.md`,
 * `CLAUDE.md` na raiz. `.claude/**` e workflows entram só na Fatia 6.
 * Match sobre o path completo do repo (POSIX, sem barra inicial).
 */
export function isInScope(path: string): boolean {
  if (path === 'README.md' || path === 'CLAUDE.md') return true;
  if (path.startsWith('docs/')) return true;
  return false;
}
