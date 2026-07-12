import { RawLink } from './link-extractor';

export interface ResolvedLink {
  /** Path normalizado do alvo no repo (POSIX), ex. "docs/specs/SPEC-001.md". */
  targetPath: string;
  anchor: string | null;
  /** Path existente no escopo, ou null se quebrado. */
  resolvedPath: string | null;
}

/**
 * Resolve um link cru contra o conjunto de paths do escopo.
 * - Markdown relativo: resolvido a partir da pasta do arquivo fonte.
 * - Wikilink: procura `<alvo>.md` no escopo, case-insensitive, por basename.
 * `scopePaths` é o conjunto de paths existentes (para detectar quebrados).
 */
export function resolveLink(
  link: RawLink,
  sourcePath: string,
  scopePaths: Set<string>,
): ResolvedLink {
  if (link.wiki) {
    const resolved = resolveWiki(link.target, scopePaths);
    return {
      targetPath: resolved ?? ensureMd(link.target),
      anchor: link.anchor,
      resolvedPath: resolved,
    };
  }

  const targetPath = normalize(joinRelative(dirname(sourcePath), link.target));
  return {
    targetPath,
    anchor: link.anchor,
    resolvedPath: scopePaths.has(targetPath) ? targetPath : null,
  };
}

/** Wikilink resolve por basename sem extensão, case-insensitive. */
function resolveWiki(name: string, scopePaths: Set<string>): string | null {
  const wanted = ensureMd(name).toLowerCase();
  for (const p of scopePaths) {
    if (basename(p).toLowerCase() === wanted) return p;
  }
  return null;
}

function ensureMd(name: string): string {
  return /\.md$/i.test(name) ? name : `${name}.md`;
}

function dirname(path: string): string {
  const i = path.lastIndexOf('/');
  return i === -1 ? '' : path.slice(0, i);
}

function basename(path: string): string {
  const i = path.lastIndexOf('/');
  return i === -1 ? path : path.slice(i + 1);
}

/** Junta um dir base com um alvo relativo (sem tocar `..` ainda). */
function joinRelative(base: string, target: string): string {
  if (target.startsWith('/')) return target.slice(1); // raiz do repo
  return base ? `${base}/${target}` : target;
}

/** Normaliza `.` e `..` num path POSIX. */
function normalize(path: string): string {
  const parts = path.split('/');
  const out: string[] = [];
  for (const part of parts) {
    if (part === '' || part === '.') continue;
    if (part === '..') out.pop();
    else out.push(part);
  }
  return out.join('/');
}
