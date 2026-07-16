import { WORKSPACE_TABS, type TabDef } from '../tabs';

/**
 * Grupos da navegação vertical (SPEC-020 §1 / DESIGN.md §2).
 *
 * Mapa 1:1 das abas de `tabs.ts` — nenhuma aba nova, nenhuma removida. Os
 * grupos são o que 12 abas horizontais já não entregavam: hierarquia legível.
 * A ordem dentro do grupo é a da spec, não a de `tabs.ts`.
 */
export const NAV_GROUPS: ReadonlyArray<{ label: string; tabIds: readonly string[] }> = [
  { label: 'Projeto', tabIds: ['overview', 'documents', 'kanban', 'graph', 'decisions'] },
  { label: 'Engenharia', tabIds: ['architecture', 'skills', 'tests', 'design', 'deploy'] },
  { label: 'Governança', tabIds: ['context', 'handoff'] },
];

export interface NavGroup {
  label: string;
  tabs: TabDef[];
}

/**
 * Resolve os grupos contra `tabs.ts`. Aba que exista em `tabs.ts` mas não esteja
 * em nenhum grupo entra num grupo final — assim uma fatia futura que adicione
 * aba a vê na sidebar mesmo esquecendo de agrupá-la (some ≠ 1:1).
 */
export function buildNavGroups(): NavGroup[] {
  const byId = new Map(WORKSPACE_TABS.map((t) => [t.id, t]));
  const grouped: NavGroup[] = NAV_GROUPS.map((g) => ({
    label: g.label,
    tabs: g.tabIds.map((id) => byId.get(id)).filter((t): t is TabDef => t !== undefined),
  }));

  const claimed = new Set(NAV_GROUPS.flatMap((g) => g.tabIds));
  const orphans = WORKSPACE_TABS.filter((t) => !claimed.has(t.id));
  return orphans.length ? [...grouped, { label: 'Outros', tabs: orphans }] : grouped;
}
