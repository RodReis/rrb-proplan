import { Entity } from '../../ingestion/domain/entity';

/** Entidades classificáveis no nível 3 — Deploy nunca é classificado (CONVENTION.md). */
export const CLASSIFIABLE_ENTITIES: Entity[] = [
  'architecture',
  'decisions',
  'design',
  'testing',
  'skills',
];

export interface ClassifyHit {
  entity: Entity;
  path: string;
  spans: string[];
}

export const CLASSIFY_SYSTEM = `Você classifica documentos livres de um repositório contra uma lista de entidades ausentes (architecture, decisions, design, testing, skills). Para cada entidade, diga se ALGUM documento livre É essa entidade pelo conteúdo — não pelo nome do arquivo.

Regras:
- Cite spans (trechos verbatim do documento) que justificam a classificação.
- Se não houver evidência clara, NÃO afirme (melhor ausente que errado).
- Responda SÓ com um array JSON, sem prosa: [{"entity","path","spans":["trecho verbatim", ...]}].`;

export function buildClassifyUser(
  freeDocs: { path: string; title: string; headings: string[]; excerpt: string }[],
  absentEntities: Entity[],
): string {
  const docList = freeDocs
    .map((d) => `### ${d.path}\nTítulo: ${d.title}\nHeadings: ${d.headings.join(' · ')}\n${d.excerpt}`)
    .join('\n\n');
  return `Entidades ausentes a classificar:\n${absentEntities.join(', ')}\n\nDocumentos livres:\n\n${docList}`;
}

export function parseClassify(text: string): ClassifyHit[] {
  const arr = extractJsonArray(text);
  return arr
    .filter((x): x is Record<string, unknown> => typeof x === 'object' && x !== null)
    .map((x) => ({
      entity: x.entity,
      path: x.path,
      spans: Array.isArray(x.spans) ? x.spans.filter((s) => typeof s === 'string') : [],
    }))
    .filter(
      (h): h is ClassifyHit =>
        typeof h.entity === 'string' &&
        (CLASSIFIABLE_ENTITIES as string[]).includes(h.entity) &&
        typeof h.path === 'string' &&
        h.path !== '' &&
        h.spans.length > 0,
    );
}

function extractJsonArray(text: string): unknown[] {
  const start = text.indexOf('[');
  if (start === -1) throw new Error('nenhum array JSON');
  let depth = 0,
    inStr = false,
    esc = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === '[') depth++;
    else if (ch === ']') {
      depth--;
      if (depth === 0) {
        return JSON.parse(text.slice(start, i + 1));
      }
    }
  }
  throw new Error('array JSON não fechado');
}
