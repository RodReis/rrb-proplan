/** Link cru extraído de um markdown, antes de resolver contra o escopo. */
export interface RawLink {
  /** Alvo como escrito (sem âncora): ex. "../specs/SPEC-001.md" ou "ARCHITECTURE". */
  target: string;
  /** Âncora após `#`, sem o `#` (metadado; não afeta resolução). */
  anchor: string | null;
  /** true se veio de wikilink `[[...]]` (resolução case-insensitive + `.md`). */
  wiki: boolean;
}

// [texto](destino) — captura o destino entre parênteses (sem espaços/título).
const MD_LINK = /\[[^\]]*\]\(\s*([^)\s]+)(?:\s+"[^"]*")?\s*\)/g;
// [[Alvo]] ou [[Alvo|label]] — captura o alvo.
const WIKILINK = /\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/g;

/**
 * Extrai links internos de um markdown. Ignora externos (http/https/mailto),
 * âncoras puras (`#secao`) e imagens não são distinguidas de links (tratadas
 * como links — o alvo inexistente vira quebrado, o que é honesto).
 */
export function extractLinks(markdown: string): RawLink[] {
  const links: RawLink[] = [];

  for (const m of markdown.matchAll(MD_LINK)) {
    const raw = m[1].trim();
    if (isExternal(raw) || raw.startsWith('#') || raw === '') continue;
    links.push(splitAnchor(raw, false));
  }

  for (const m of markdown.matchAll(WIKILINK)) {
    const raw = m[1].trim();
    if (raw === '') continue;
    links.push(splitAnchor(raw, true));
  }

  return links;
}

function isExternal(target: string): boolean {
  return /^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith('//');
}

function splitAnchor(raw: string, wiki: boolean): RawLink {
  const hash = raw.indexOf('#');
  if (hash === -1) return { target: raw, anchor: null, wiki };
  return {
    target: raw.slice(0, hash) || raw, // "#a" já filtrado antes; aqui há path
    anchor: raw.slice(hash + 1) || null,
    wiki,
  };
}
