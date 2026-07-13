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
  [/^(finalizad|aceito|finalized)/i, 'finalized'],
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
  const text = m[1];
  // Placeholder de coluna vazia — em qualquer forma (`_(vazio)_`, `(vazio)`).
  if (/^_?\(vazio\)_?$/.test(text)) return null;

  // Extrai `#N` e `prio: X` do texto original. Tolera markdown entre o rótulo
  // e o valor (`prio: **alta**`) — o STATUS.md humano às vezes enfatiza.
  const number = /#(\d+)/.exec(text)?.[1];
  const priority = /prio:\s*\**\s*(alta|media|baixa)/i
    .exec(text)?.[1]
    ?.toLowerCase();

  return {
    title: cleanTitle(text),
    column,
    priority: (priority as IssuePriority) ?? null,
    number: number ? Number(number) : null,
  };
}

// Palavras que, num parêntese ao fim do título, são metadados a descartar.
const META_KEYWORDS = /^(#\d+|prio:|spec:|em:|desde:|fechado em|descartado em|concluído)/i;

/**
 * Limpa o título de um card legado: remove markdown inline (`**`, `` ` ``, `~~`)
 * e os parênteses de metadados ao final (spec/prio/datas/#N). Preserva
 * parênteses que fazem parte do texto (ex.: "(ADR-014)" não é metadado — fica).
 */
function cleanTitle(text: string): string {
  let t = text;
  // Remove parênteses de metadados no fim, repetidamente (há vários encadeados).
  for (;;) {
    const m = /\s*\(([^()]*)\)\s*$/.exec(t);
    if (!m || !META_KEYWORDS.test(m[1].trim())) break;
    t = t.slice(0, m.index).trimEnd();
  }
  // Remove ênfase markdown, mantendo o texto.
  t = t.replace(/\*\*(.+?)\*\*/g, '$1').replace(/`([^`]+)`/g, '$1').replace(/~~(.+?)~~/g, '$1');
  return t.trim();
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
  // Normaliza CRLF: um STATUS.md de repo Windows tem `\r\n`, e o `\r` residual
  // faz o `$` do regex de heading falhar (bug pego no dogfooding do rrb-proplan).
  for (const raw of content.split(/\r?\n/)) {
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
