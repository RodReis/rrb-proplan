import { SyncService } from './sync.service';

/**
 * Integração SBOM ↔ persistência (SPEC-023): prova o passo `updateStack` sem
 * rede — o GithubGitClient é um duplo. O método é privado; chamamos via
 * bracket-access, o padrão já usado em deploy-probe-integration.spec.
 *
 * O que estes testes protegem, em uma frase cada: o sync NÃO cai quando o SBOM
 * falha, o fallback é gravado como estado (não como silêncio), e o SHA de
 * ancoragem é o do HEAD — não o de `docs/`.
 */
function makeSvc(git: Record<string, unknown>) {
  const update = jest.fn().mockResolvedValue({});
  const prisma = { project: { update } } as any;
  const svc = new SyncService(
    prisma, {} as any, git as any, {} as any, {} as any, {} as any, {} as any,
  );
  return { svc, update };
}

const PURL = (locator: string) => ({
  name: locator,
  versionInfo: '1.0.0',
  externalRefs: [{ referenceType: 'purl', referenceLocator: locator }],
});

describe('updateStack — coleta do SBOM no sync', () => {
  it('persiste ecossistemas, pacotes e o SHA do HEAD quando detecta', async () => {
    const { svc, update } = makeSvc({
      getSbom: jest.fn().mockResolvedValue({
        sbom: { packages: [PURL('pkg:npm/react@18.2.0')] },
      }),
      getHeadSha: jest.fn().mockResolvedValue('abc123'),
    });

    await svc['updateStack']('p1', 'tok', 'owner', 'repo', 'main');

    const data = update.mock.calls[0][0].data;
    expect(data.stackEnabled).toBe(true);
    expect(data.stackEcosystems).toEqual(['npm']);
    expect(data.stackPackages).toEqual([
      { ecosystem: 'npm', name: 'react', version: '1.0.0' },
    ]);
    expect(data.stackSourceSha).toBe('abc123');
    expect(data.stackObservedAt).toBeInstanceOf(Date);
  });

  it('ancora ao HEAD do default branch, não a docs/', async () => {
    const getHeadSha = jest.fn().mockResolvedValue('sha');
    const { svc } = makeSvc({
      getSbom: jest.fn().mockResolvedValue({
        sbom: { packages: [PURL('pkg:npm/react@18')] },
      }),
      getHeadSha,
    });

    await svc['updateStack']('p1', 'tok', 'owner', 'repo', 'develop');

    expect(getHeadSha).toHaveBeenCalledWith('tok', 'owner', 'repo', 'develop');
  });

  // Fallback obrigatório: `enabled: false` é GRAVADO. Não gravar deixaria o
  // campo NULL, que a aba lê como "nunca sincronizado" — o erro mudo que a
  // spec proíbe.
  it('SBOM negado (null) → grava enabled=false, não falha em silêncio', async () => {
    const getHeadSha = jest.fn();
    const { svc, update } = makeSvc({
      getSbom: jest.fn().mockResolvedValue(null),
      getHeadSha,
    });

    await svc['updateStack']('p1', 'tok', 'owner', 'repo', 'main');

    const data = update.mock.calls[0][0].data;
    expect(data.stackEnabled).toBe(false);
    expect(data.stackEcosystems).toEqual([]);
    expect(getHeadSha).not.toHaveBeenCalled(); // sem detecção, não gasta request
  });

  it('SBOM vazio (repo sem manifests) → mesmo estado de fallback', async () => {
    const { svc, update } = makeSvc({
      getSbom: jest.fn().mockResolvedValue({ sbom: { packages: [] } }),
      getHeadSha: jest.fn(),
    });

    await svc['updateStack']('p1', 'tok', 'owner', 'repo', 'main');

    expect(update.mock.calls[0][0].data.stackEnabled).toBe(false);
  });

  // Resiliência (ADR-002): mesma regra de updateCiStatus/updateDeploySignals.
  it('erro do GitHub NÃO derruba o sync — engole e mantém o estado anterior', async () => {
    const { svc, update } = makeSvc({
      getSbom: jest.fn().mockRejectedValue(new Error('GitHub API 500')),
      getHeadSha: jest.fn(),
    });

    await expect(
      svc['updateStack']('p1', 'tok', 'owner', 'repo', 'main'),
    ).resolves.toBeUndefined();
    expect(update).not.toHaveBeenCalled();
  });

  it('falha do getHeadSha não perde a detecção — sync segue', async () => {
    const { svc, update } = makeSvc({
      getSbom: jest.fn().mockResolvedValue({
        sbom: { packages: [PURL('pkg:npm/react@18')] },
      }),
      getHeadSha: jest.fn().mockRejectedValue(new Error('boom')),
    });

    await expect(
      svc['updateStack']('p1', 'tok', 'owner', 'repo', 'main'),
    ).resolves.toBeUndefined();
    expect(update).not.toHaveBeenCalled();
  });
});
