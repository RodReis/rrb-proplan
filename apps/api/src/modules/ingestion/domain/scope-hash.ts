import { createHash } from 'crypto';

/** Entrada mínima do escopo para o hash: caminho + sha do blob. */
export interface ScopeEntry {
  path: string;
  blobSha: string;
}

/**
 * docs_scope_hash: SHA-256 da lista ordenada de `(path, blob_sha)` do escopo.
 * Determinístico — mesma árvore de docs sempre produz o mesmo hash.
 * Ordena por path para ser estável independente da ordem da Trees API.
 */
export function computeScopeHash(entries: ScopeEntry[]): string {
  const ordered = [...entries].sort((a, b) => a.path.localeCompare(b.path));
  const hash = createHash('sha256');
  for (const e of ordered) {
    hash.update(e.path);
    hash.update('\0');
    hash.update(e.blobSha);
    hash.update('\n');
  }
  return hash.digest('hex');
}
