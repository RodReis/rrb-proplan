export interface DecisionItem {
  title: string;
  status: string | null;
  date: string | null;
  path: string;
  anchor: string | null; // âncora no doc (só quando arquivo único)
}

/** Slug de âncora GitHub-like: minúsculas, espaços→hífen, remove pontuação leve. */
function slug(title: string): string {
  return title
    .toLowerCase()
    .trim()
    .replace(/[^\w\s—-]/g, '')
    .replace(/\s+/g, '-');
}

function baseNoExt(path: string): string {
  const b = path.split('/').pop() ?? path;
  const dot = b.lastIndexOf('.');
  return dot > 0 ? b.slice(0, dot) : b;
}

/** Status/data de linhas tipo "Status: aceito" / "Data: 2026-07-12" logo abaixo do título. */
function fieldAfter(block: string, field: RegExp): string | null {
  const m = block.match(field);
  return m ? m[1].trim() : null;
}

/**
 * Índice de decisões. Um arquivo (DECISIONS.md) → fatia por `## `. Coleção
 * (adr/*.md) → um item por arquivo, título do primeiro `# `.
 */
export function parseDecisions(docs: { path: string; content: string }[]): DecisionItem[] {
  if (docs.length === 1 && /decisions|decisoes/i.test(docs[0].path)) {
    return sliceSingle(docs[0]);
  }
  return docs.map((d) => sliceCollectionEntry(d));
}

function sliceSingle(doc: { path: string; content: string }): DecisionItem[] {
  const parts = doc.content.split(/^##\s+/m).slice(1);
  return parts.map((block) => {
    const title = block.split('\n', 1)[0].trim();
    return {
      title,
      status: fieldAfter(block, /Status:\s*(.+)/i),
      date: fieldAfter(block, /Data:\s*(.+)/i),
      path: doc.path,
      anchor: slug(title),
    };
  });
}

function sliceCollectionEntry(doc: { path: string; content: string }): DecisionItem {
  const h1 = doc.content.match(/^#\s+(.+)$/m);
  return {
    title: h1 ? h1[1].trim() : baseNoExt(doc.path),
    status: fieldAfter(doc.content, /Status:\s*(.+)/i),
    date: fieldAfter(doc.content, /Data:\s*(.+)/i),
    path: doc.path,
    anchor: null,
  };
}
