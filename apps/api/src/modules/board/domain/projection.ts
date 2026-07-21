import { COLUMN_TITLE } from '../../../shared/convention/columns';
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
  /** Número do épico-pai (null = raiz). Agrupa o card sob o épico (SPEC-024). */
  parentNumber: number | null;
}

/** Épico (issue com sub-issues) — cabeçalho de subgrupo na projeção (SPEC-024). */
export interface ProjectionEpic {
  number: number;
  title: string;
}

const NO_EPIC = 'Sem épico';

// Linha de um card na projeção (formato da CONVENTION.md):
//   `- Título (#42, prio: alta)`
//   Feito:       `- Título (#12, fechado em: 2026-06-20)`
//   Finalizado:  `- Título (#12, finalizado em: 2026-06-20)`
//   Descartado:  `- Título (#27, descartado em: 2026-07-02)`
function cardLine(card: ProjectionCard): string {
  const parts: string[] = [`#${card.number}`];
  if (card.priority) parts.push(`prio: ${card.priority}`);
  if (card.closedAt) {
    const date = card.closedAt.toISOString().slice(0, 10);
    if (card.column === 'done') parts.push(`fechado em: ${date}`);
    else if (card.column === 'finalized') parts.push(`finalizado em: ${date}`);
    else if (card.column === 'discarded') parts.push(`descartado em: ${date}`);
  }
  return `- ${card.title} (${parts.join(', ')})`;
}

/**
 * Corpo de uma coluna: cards agrupados por épico (SPEC-024, opção A). Cada épico
 * vira um subcabeçalho H3 (`### Título (#N)`); os cards raiz caem sob "Sem épico".
 * Um subgrupo só aparece se tiver card. Coluna vazia → `_(vazio)_`.
 */
function columnBody(items: ProjectionCard[], epicTitleByNumber: Map<number, string>): string {
  if (!items.length) return '_(vazio)_';

  const byEpic = new Map<number | null, ProjectionCard[]>();
  for (const c of items) {
    const key = c.parentNumber ?? null;
    (byEpic.get(key) ?? byEpic.set(key, []).get(key)!).push(c);
  }

  // Épicos primeiro (ordem de inserção dos cards), "Sem épico" por último.
  const epicKeys = [...byEpic.keys()].filter((k): k is number => k !== null);
  const groups: string[] = [];
  for (const epicNumber of epicKeys) {
    const title = epicTitleByNumber.get(epicNumber) ?? `#${epicNumber}`;
    const lines = byEpic.get(epicNumber)!.map(cardLine).join('\n');
    groups.push(`### ${title} (#${epicNumber})\n\n${lines}`);
  }
  const rootCards = byEpic.get(null);
  if (rootCards?.length) {
    groups.push(`### ${NO_EPIC}\n\n${rootCards.map(cardLine).join('\n')}`);
  }
  return groups.join('\n\n');
}

/**
 * Markdown inteiro da projeção (formato da CONVENTION.md: frontmatter + header
 * de artefato gerado + seções H2 por coluna). Dentro de cada coluna, os cards
 * são subagrupados por épico em H3 (SPEC-024). Feito/Descartado carregam a data
 * real de `closed_at` (fato). `updated` é injetado pelo caller (data do commit).
 */
export function generateProjection(
  cards: ProjectionCard[],
  updated: string,
  epics: ProjectionEpic[] = [],
): string {
  const epicTitleByNumber = new Map(epics.map((e) => [e.number, e.title]));
  const byColumn = new Map<BoardColumn, ProjectionCard[]>();
  for (const col of COLUMNS) byColumn.set(col, []);
  for (const c of cards) byColumn.get(c.column)?.push(c);

  const sections = COLUMNS.map((col) => {
    const items = byColumn.get(col) ?? [];
    return `## ${COLUMN_TITLE[col]}\n\n${columnBody(items, epicTitleByNumber)}`;
  });

  const frontmatter = `---\nproplan: v1\nupdated: ${updated}\n---`;
  return `${frontmatter}\n${PROJECTION_HEADER}\n# Status\n\n${sections.join('\n\n')}\n`;
}
