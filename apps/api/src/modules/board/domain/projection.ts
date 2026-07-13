import { BoardColumn, COLUMNS, IssuePriority } from './column-mapping';

// Gerador da projeção .proplan/STATUS.md (SPEC-005 / ADR-011). Escrita de fora
// para dentro: o arquivo inteiro é regerado a cada vez — é artefato de build,
// não documento humano. Não há round-trip fiel.

export const PROJECTION_HEADER =
  '<!-- gerado pelo ProPlan a partir das Issues — não edite à mão -->';
export const PROJECTION_COMMIT_MESSAGE =
  'proplan: atualiza STATUS.md (projeção das Issues)';

export interface ProjectionCard {
  number: number;
  title: string;
  priority: IssuePriority | null;
  column: BoardColumn;
  closedAt: Date | null;
}

const COLUMN_TITLE: Record<BoardColumn, string> = {
  backlog: 'Backlog',
  todo: 'A Fazer',
  doing: 'Em Andamento',
  done: 'Feito',
  discarded: 'Descartado',
};

// Linha de um card na projeção (formato da CONVENTION.md):
//   `- Título (#42, prio: alta)`
//   Feito:      `- Título (#12, fechado em: 2026-06-20)`
//   Descartado: `- Título (#27, descartado em: 2026-07-02)`
function cardLine(card: ProjectionCard): string {
  const parts: string[] = [`#${card.number}`];
  if (card.priority) parts.push(`prio: ${card.priority}`);
  if (card.closedAt) {
    const date = card.closedAt.toISOString().slice(0, 10);
    if (card.column === 'done') parts.push(`fechado em: ${date}`);
    else if (card.column === 'discarded') parts.push(`descartado em: ${date}`);
  }
  return `- ${card.title} (${parts.join(', ')})`;
}

/**
 * Markdown inteiro da projeção (formato da CONVENTION.md: frontmatter + header
 * de artefato gerado + seções H2 por coluna). Feito/Descartado carregam a data
 * real de `closed_at` (fato). `updated` é injetado pelo caller (data do commit).
 */
export function generateProjection(cards: ProjectionCard[], updated: string): string {
  const byColumn = new Map<BoardColumn, ProjectionCard[]>();
  for (const col of COLUMNS) byColumn.set(col, []);
  for (const c of cards) byColumn.get(c.column)?.push(c);

  const sections = COLUMNS.map((col) => {
    const items = byColumn.get(col) ?? [];
    const lines = items.length ? items.map(cardLine).join('\n') : '_(vazio)_';
    return `## ${COLUMN_TITLE[col]}\n\n${lines}`;
  });

  const frontmatter = `---\nproplan: v1\nupdated: ${updated}\n---`;
  return `${frontmatter}\n${PROJECTION_HEADER}\n# Status\n\n${sections.join('\n\n')}\n`;
}
