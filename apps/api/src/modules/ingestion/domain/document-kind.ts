/** Tipo de documento para tratamento no sync e preview no viewer. */
export type DocKind = 'markdown' | 'pdf' | 'image' | 'html' | 'office' | 'binary';

const EXT: Record<string, DocKind> = {
  md: 'markdown', markdown: 'markdown', txt: 'markdown', yml: 'markdown', yaml: 'markdown',
  pdf: 'pdf',
  png: 'image', jpg: 'image', jpeg: 'image', gif: 'image', svg: 'image', webp: 'image',
  html: 'html', htm: 'html',
  docx: 'office',
};

/**
 * Classifica o documento pela extensão (case-insensitive). Só `markdown` é
 * baixado e persistido no sync (alimenta abas/grafo/resolução); o resto grava
 * só metadado e ganha preview sob demanda. Sem extensão / desconhecido → binary.
 */
export function classifyKind(path: string): DocKind {
  const base = path.split('/').pop() ?? path;
  const dot = base.lastIndexOf('.');
  if (dot <= 0) return 'binary';
  const ext = base.slice(dot + 1).toLowerCase();
  return EXT[ext] ?? 'binary';
}
