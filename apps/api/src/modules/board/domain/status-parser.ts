import { BoardColumn, IssuePriority } from './column-mapping';
import { PROJECTION_HEADER } from './projection';

// Parser de leitura de STATUS.md (SPEC-005). Usado só na importação de legado
// e no modo degradado — NÃO há round-trip fiel (a projeção é sempre regerada).
// Tolerante: aceita o formato canônico e STATUS.md legados mais livres.

export interface ParsedCard {
  title: string;
  column: BoardColumn;
  priority: IssuePriority | null;
  /** Número da issue se o item já traz `#N` (projeção); null em legado cru. */
  number: number | null;
}

// Título da seção H2 → coluna. Aceita variações comuns de legado.
const SECTION_TO_COLUMN: [RegExp, BoardColumn][] = [
  [/^backlog/i, 'backlog'],
  [/^(a fazer|todo|to do|a-fazer)/i, 'todo'],
  [/^(em andamento|doing|in progress|fazendo)/i, 'doing'],
  [/^(feito|done|conclu)/i, 'done'],
  [/^(descartad|cancelad|discarded)/i, 'discarded'],
];

function columnFromHeading(heading: string): BoardColumn | null {
  const h = heading.trim();
  for (const [re, col] of SECTION_TO_COLUMN) if (re.test(h)) return col;
  return null;
}

function parseItem(line: string, column: BoardColumn): ParsedCard | null {
  const m = /^\s*[-*]\s+(.+?)\s*$/.exec(line);
  if (!m) return null;
  let text = m[1];
  if (text === '_(vazio)_') return null;

  // Extrai `#N` e `prio: X` do parêntese de metadados, se houver.
  const number = /#(\d+)/.exec(text)?.[1];
  const priority = /prio:\s*(alta|media|baixa)/i.exec(text)?.[1]?.toLowerCase();

  // Título = texto sem o parêntese final de metadados.
  const paren = /\s*\(([^)]*#\d+[^)]*|[^)]*prio:[^)]*)\)\s*$/i;
  text = text.replace(paren, '').trim();

  return {
    title: text,
    column,
    priority: (priority as IssuePriority) ?? null,
    number: number ? Number(number) : null,
  };
}

/** True se o conteúdo tem o cabeçalho de projeção (já é gerado pelo ProPlan). */
export function isGeneratedProjection(content: string): boolean {
  return content.includes(PROJECTION_HEADER);
}

/**
 * Cards de um STATUS.md. Percorre as seções H2; itens de lista viram cards com
 * a coluna da seção. Seções não reconhecidas são ignoradas (não inventa coluna).
 */
export function parseStatusMarkdown(content: string): ParsedCard[] {
  const cards: ParsedCard[] = [];
  let current: BoardColumn | null = null;
  for (const raw of content.split('\n')) {
    const heading = /^##\s+(.+)$/.exec(raw);
    if (heading) {
      current = columnFromHeading(heading[1]);
      continue;
    }
    if (!current) continue;
    const card = parseItem(raw, current);
    if (card) cards.push(card);
  }
  return cards;
}
