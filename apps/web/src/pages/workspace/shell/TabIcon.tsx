/**
 * Ícone por aba (DESIGN.md §2 — item ativo leva o ícone em `--accent`).
 *
 * Inline e monocromático: `currentColor` deixa o estado (ativo/inerte) mandar na
 * cor, e não entra dependência de biblioteca de ícones só por 12 glifos.
 */
const PATHS: Record<string, string> = {
  overview: 'M3 3h7v7H3zM14 3h7v7h-7zM14 14h7v7h-7zM3 14h7v7H3z',
  documents: 'M4 3h9l5 5v13H4zM13 3v6h5',
  kanban: 'M4 4h4v16H4zM10 4h4v10h-4zM16 4h4v13h-4z',
  graph: 'M5 6a2 2 0 1 0 0-.01M19 6a2 2 0 1 0 0-.01M12 19a2 2 0 1 0 0-.01M6.7 7.2 11 17M17.3 7.2 13 17',
  decisions: 'M12 3v18M5 8h14M7 12h10M9 16h6',
  architecture: 'M4 20V9l8-6 8 6v11M9 20v-6h6v6',
  skills: 'M12 3l2.4 5.4L20 9.5l-4 4 1 5.5-5-2.8-5 2.8 1-5.5-4-4 5.6-1.1z',
  tests: 'M9 3v6l-5 9a2 2 0 0 0 1.7 3h12.6a2 2 0 0 0 1.7-3l-5-9V3M9 3h6M7.5 15h9',
  design: 'M12 3a9 9 0 1 0 0 18h1.5a2 2 0 0 0 1.4-3.4 2 2 0 0 1 1.4-3.4H18a3 3 0 0 0 3-3 9 9 0 0 0-9-8.2M7.5 11a1 1 0 1 0 0-.01M12 7.5a1 1 0 1 0 0-.01M16.5 11a1 1 0 1 0 0-.01',
  deploy: 'M4 17h16M6 13l6-9 6 9M9 13v4M15 13v4',
  context: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18M12 8v5M12 16.5v.5',
  handoff: 'M4 12h11M11 7l5 5-5 5M17 4h3v16h-3',
};

export function TabIcon({ id }: { id: string }) {
  const d = PATHS[id] ?? PATHS.documents;
  return (
    <svg
      aria-hidden
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="shrink-0"
    >
      <path d={d} />
    </svg>
  );
}
