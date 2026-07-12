import { ScopeEntry } from './scope-hash';

export interface DocDiff {
  /** Paths novos no remoto (baixar blob). */
  added: ScopeEntry[];
  /** Paths existentes com blobSha diferente (baixar blob). */
  updated: ScopeEntry[];
  /** Paths que sumiram do remoto (remover do banco — banco = índice, ADR). */
  removed: string[];
}

/**
 * Compara o escopo remoto (path→blobSha da Trees API) com o estado local
 * (path→blobSha no banco). Só added/updated exigem download de blob.
 */
export function diffScope(
  remote: ScopeEntry[],
  local: Map<string, string>,
): DocDiff {
  const added: ScopeEntry[] = [];
  const updated: ScopeEntry[] = [];
  const remotePaths = new Set<string>();

  for (const entry of remote) {
    remotePaths.add(entry.path);
    const localSha = local.get(entry.path);
    if (localSha === undefined) added.push(entry);
    else if (localSha !== entry.blobSha) updated.push(entry);
  }

  const removed: string[] = [];
  for (const path of local.keys()) {
    if (!remotePaths.has(path)) removed.push(path);
  }

  return { added, updated, removed };
}
