import { SyncService } from './sync.service';

/**
 * SyncService.listScope — espera a Trees API refletir um write-back antes de o
 * sync decidir noop (consistência eventual — root-cause do bug do aceite do
 * landpage: promover DESIGN.md → noop → doc não ingerido até sync manual).
 *
 * Testa o método privado direto (svc['listScope']): é a unidade da lógica nova;
 * montar o runSync inteiro arrastaria prisma/links/resolution/events sem ganho.
 * O sleep resolve na hora (setTimeout mockado) para não gastar os ~7,5s reais.
 */
describe('SyncService.listScope — propagação do write-back', () => {
  beforeEach(() => {
    jest
      .spyOn(global, 'setTimeout')
      .mockImplementation(((fn: () => void) => {
        fn();
        return 0 as unknown as NodeJS.Timeout;
      }) as unknown as typeof setTimeout);
  });
  afterEach(() => jest.restoreAllMocks());

  const project = { owner: 'o', name: 'r', defaultBranch: 'main', id: 'p1' };
  const DOC = 'docs/DESIGN.md';

  function makeSvc(git: any) {
    return new SyncService({} as any, {} as any, git, {} as any, {} as any, {} as any, {} as any);
  }

  it('sem expectativa → uma única leitura, sem esperar', async () => {
    const listTree = jest.fn().mockResolvedValue([{ path: DOC, blobSha: 'old' }]);
    const svc = makeSvc({ listTree });

    const scope = await svc['listScope']('tok', project, {
      expectPath: null,
      expectBlobSha: null,
    });

    expect(listTree).toHaveBeenCalledTimes(1);
    expect(scope).toEqual([{ path: DOC, blobSha: 'old' }]);
  });

  it('árvore já reflete o blob esperado → não repete a leitura', async () => {
    const listTree = jest.fn().mockResolvedValue([{ path: DOC, blobSha: 'new' }]);
    const svc = makeSvc({ listTree });

    await svc['listScope']('tok', project, {
      expectPath: DOC,
      expectBlobSha: 'new',
    });

    expect(listTree).toHaveBeenCalledTimes(1);
  });

  it('árvore velha nas 1as leituras → repete até refletir o blob esperado', async () => {
    const listTree = jest
      .fn()
      .mockResolvedValueOnce([{ path: DOC, blobSha: 'old' }])
      .mockResolvedValueOnce([{ path: DOC, blobSha: 'old' }])
      .mockResolvedValueOnce([{ path: DOC, blobSha: 'new' }]);
    const svc = makeSvc({ listTree });

    const scope = await svc['listScope']('tok', project, {
      expectPath: DOC,
      expectBlobSha: 'new',
    });

    expect(listTree).toHaveBeenCalledTimes(3);
    expect(scope).toEqual([{ path: DOC, blobSha: 'new' }]);
  });

  it('blob nunca propaga → estoura o teto e segue (não trava)', async () => {
    const listTree = jest.fn().mockResolvedValue([{ path: DOC, blobSha: 'old' }]);
    const svc = makeSvc({ listTree });

    const scope = await svc['listScope']('tok', project, {
      expectPath: DOC,
      expectBlobSha: 'new',
    });

    // 1 leitura inicial + 3 retries (TREE_PROPAGATION_RETRIES) = 4, e retorna
    // a última árvore lida em vez de travar/lançar.
    expect(listTree).toHaveBeenCalledTimes(4);
    expect(scope).toEqual([{ path: DOC, blobSha: 'old' }]);
  });
});
