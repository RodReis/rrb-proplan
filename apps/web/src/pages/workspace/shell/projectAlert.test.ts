import { describe, expect, it } from 'vitest';
import type { Project } from '../../../lib/api';
import { projectAlert } from './projectAlert';

function project(over: Partial<Project> = {}): Project {
  return {
    id: 'p1',
    owner: 'RodReis',
    name: 'rrb-proplan',
    description: null,
    defaultBranch: 'main',
    githubRepoId: 1,
    installationId: 1,
    installationStatus: 'active',
    needsIssueImport: false,
    docsScopeHash: null,
    lastSyncAt: null,
    deployVerdict: null,
    ...over,
  };
}

describe('projectAlert', () => {
  it('não acusa nada quando o projeto está saudável', () => {
    expect(projectAlert(project())).toBeNull();
  });

  it('acusa cada sinal isolado', () => {
    expect(projectAlert(project({ installationStatus: 'missing' }))?.kind).toBe(
      'sem-instalacao',
    );
    expect(projectAlert(project({ deployVerdict: 'discordam' }))?.kind).toBe(
      'deploy-divergente',
    );
    expect(projectAlert(project({ deployVerdict: 'omissa' }))?.kind).toBe(
      'deploy-duvida',
    );
    expect(projectAlert(project({ needsIssueImport: true }))?.kind).toBe('importar');
  });

  // A precedência é o ponto da regra: com tudo aceso, só o mais grave aparece.
  it('mostra apenas o mais grave quando vários sinais coexistem', () => {
    const todosOsSinais = project({
      installationStatus: 'missing',
      deployVerdict: 'discordam',
      needsIssueImport: true,
    });
    expect(projectAlert(todosOsSinais)?.kind).toBe('sem-instalacao');
  });

  it('respeita a ordem deploy divergente > deploy? > importar', () => {
    expect(
      projectAlert(project({ deployVerdict: 'discordam', needsIssueImport: true }))?.kind,
    ).toBe('deploy-divergente');
    expect(
      projectAlert(project({ deployVerdict: 'omissa', needsIssueImport: true }))?.kind,
    ).toBe('deploy-duvida');
  });
});
