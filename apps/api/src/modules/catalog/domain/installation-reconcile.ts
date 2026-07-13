/**
 * Reconciliação de instalação (ADR-015 / SPEC-008): um projeto gerenciado cujo
 * repo não aparece em nenhuma instalação acessível perdeu o App → `missing`
 * (escritas desabilitadas, leitura do cache continua). Se voltou a aparecer,
 * volta a `active` e ganha o installationId corrente.
 *
 * Função pura: recebe o estado atual dos projetos e o mapa repoId→installationId
 * visível agora, devolve só as mudanças a persistir. Nunca falha em silêncio —
 * a ausência é informação, virada em estado explícito.
 */

export type InstallationStatus = 'active' | 'missing';

export interface ProjectInstallationState {
  id: string;
  githubRepoId: string; // BigInt serializado como string
  installationId: number | null;
  installationStatus: InstallationStatus;
}

export interface InstallationUpdate {
  projectId: string;
  installationId: number | null;
  installationStatus: InstallationStatus;
}

/** Diff mínimo: só projetos cujo status ou installationId mudou. */
export function reconcileInstallations(
  projects: ProjectInstallationState[],
  visibleRepoInstallation: Map<string, number>,
): InstallationUpdate[] {
  const updates: InstallationUpdate[] = [];
  for (const p of projects) {
    const found = visibleRepoInstallation.get(p.githubRepoId) ?? null;
    const nextStatus: InstallationStatus = found !== null ? 'active' : 'missing';
    if (found !== p.installationId || nextStatus !== p.installationStatus) {
      updates.push({
        projectId: p.id,
        installationId: found,
        installationStatus: nextStatus,
      });
    }
  }
  return updates;
}
