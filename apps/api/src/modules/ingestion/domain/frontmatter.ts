import matter from 'gray-matter';

export interface ParsedFrontmatter {
  /** Frontmatter YAML como objeto, ou null se ausente/vazio. */
  data: Record<string, unknown> | null;
  /** true se o documento adere à convenção (`proplan: v1`). CONVENTION.md. */
  isConventional: boolean;
}

/**
 * Extrai o frontmatter YAML de um markdown. Documento com `proplan: v1` é
 * marcado conventional (alimenta as abas); sem isso é documento livre.
 * gray-matter nunca lança em MD malformado — retorna data vazio.
 */
export function parseFrontmatter(content: string): ParsedFrontmatter {
  let data: Record<string, unknown> = {};
  try {
    data = matter(content).data as Record<string, unknown>;
  } catch {
    // frontmatter YAML inválido → tratar como documento sem convenção
    data = {};
  }
  const hasData = data && Object.keys(data).length > 0;
  return {
    data: hasData ? data : null,
    isConventional: data?.['proplan'] === 'v1',
  };
}
