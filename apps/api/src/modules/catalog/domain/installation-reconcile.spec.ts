import {
  ProjectInstallationState,
  reconcileInstallations,
} from './installation-reconcile';

const project = (
  over: Partial<ProjectInstallationState> = {},
): ProjectInstallationState => ({
  id: 'p1',
  githubRepoId: '100',
  installationId: 5,
  installationStatus: 'active',
  ...over,
});

describe('reconcileInstallations', () => {
  it('projeto ativo cujo repo sumiu das instalações → missing', () => {
    const updates = reconcileInstallations([project()], new Map());
    expect(updates).toEqual([
      { projectId: 'p1', installationId: null, installationStatus: 'missing' },
    ]);
  });

  it('projeto missing cujo repo reapareceu → active com o installationId novo', () => {
    const updates = reconcileInstallations(
      [project({ installationId: null, installationStatus: 'missing' })],
      new Map([['100', 9]]),
    );
    expect(updates).toEqual([
      { projectId: 'p1', installationId: 9, installationStatus: 'active' },
    ]);
  });

  it('sem mudança (mesmo installationId e status) → nenhum update', () => {
    const updates = reconcileInstallations(
      [project({ installationId: 5, installationStatus: 'active' })],
      new Map([['100', 5]]),
    );
    expect(updates).toEqual([]);
  });

  it('repo migrou de instalação (5 → 7) → atualiza installationId', () => {
    const updates = reconcileInstallations(
      [project({ installationId: 5 })],
      new Map([['100', 7]]),
    );
    expect(updates).toEqual([
      { projectId: 'p1', installationId: 7, installationStatus: 'active' },
    ]);
  });

  it('primeira marcação: projeto default active/id-nulo ganha o id da instalação', () => {
    const updates = reconcileInstallations(
      [project({ installationId: null, installationStatus: 'active' })],
      new Map([['100', 3]]),
    );
    expect(updates).toEqual([
      { projectId: 'p1', installationId: 3, installationStatus: 'active' },
    ]);
  });
});
