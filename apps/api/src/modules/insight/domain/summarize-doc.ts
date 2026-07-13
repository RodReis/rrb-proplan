const EXCERPT_LINES = 40;

/** Metadados leves de um doc para o prompt de arestas (título, headings, excerpt). */
export interface DocSummary {
  title: string;
  headings: string[];
  excerpt: string;
}

/** Extrai título (1ª linha "# "), headings ("## ") e excerpt (~40 primeiras linhas). */
export function summarizeDoc(content: string): DocSummary {
  const lines = content.split('\n');
  const titleLine = lines.find((l) => l.startsWith('# '));
  const headings = lines
    .filter((l) => l.startsWith('## '))
    .map((l) => l.slice(3).trim());

  return {
    title: titleLine ? titleLine.slice(2).trim() : '',
    headings,
    excerpt: lines.slice(0, EXCERPT_LINES).join('\n'),
  };
}
