import { Prisma } from '@prisma/client';
import { IngestionService } from './ingestion.service';

function makeSvc(overrides: any = {}) {
  const created: any[] = [];
  const prisma = {
    document: { findMany: jest.fn().mockResolvedValue(overrides.docs ?? []) },
    suppressedLink: {
      findMany: jest.fn().mockResolvedValue(overrides.suppressed ?? []),
      create: jest.fn().mockResolvedValue({}),
    },
    docLink: {
      deleteMany: jest.fn().mockResolvedValue({}),
      createMany: jest.fn().mockImplementation(({ data }: any) => { created.push(...data); return Promise.resolve({}); }),
    },
    project: { findFirst: jest.fn().mockResolvedValue({ id: 'p1' }) },
    $transaction: jest.fn().mockImplementation((ops: any[]) => Promise.all(ops)),
  };
  return { svc: new IngestionService(prisma as any, {} as any, {} as any, {} as any), prisma, created };
}

describe('IngestionService.writeInferredEdges', () => {
  it('resolve paths→ids, exclui suprimidas, replace-all das inferidas', async () => {
    const { svc, prisma, created } = makeSvc({
      docs: [{ id: 'a', path: 'docs/a.md' }, { id: 'b', path: 'docs/b.md' }, { id: 'c', path: 'docs/c.md' }],
      suppressed: [{ sourcePath: 'docs/a.md', targetPath: 'docs/c.md' }],
    });
    await svc.writeInferredEdges('p1', [
      { sourcePath: 'docs/a.md', targetPath: 'docs/b.md', reason: 'ambos falam de X' },
      { sourcePath: 'docs/a.md', targetPath: 'docs/c.md', reason: 'suprimida — não deve entrar' },
    ]);
    // deleta as inferidas antigas antes de criar
    expect(prisma.docLink.deleteMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ projectId: 'p1', kind: 'inferred' }) }));
    // só a não-suprimida vira aresta, com kind inferred + reason + ids resolvidos
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({ projectId: 'p1', sourceDocumentId: 'a', targetDocumentId: 'b', kind: 'inferred', reason: 'ambos falam de X' });
  });

  it('descarta par cujo source/target não existe como document', async () => {
    const { svc, created } = makeSvc({ docs: [{ id: 'a', path: 'docs/a.md' }] });
    await svc.writeInferredEdges('p1', [{ sourcePath: 'docs/a.md', targetPath: 'docs/naoexiste.md', reason: 'r' }]);
    expect(created).toHaveLength(0);
  });
});

describe('IngestionService.suppressEdge', () => {
  it('grava SuppressedLink e remove a aresta inferida correspondente', async () => {
    const { svc, prisma } = makeSvc();
    await svc.suppressEdge('p1', 'docs/a.md', 'docs/b.md');
    expect(prisma.suppressedLink.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ projectId: 'p1', sourcePath: 'docs/a.md', targetPath: 'docs/b.md' }) }));
    expect(prisma.docLink.deleteMany).toHaveBeenCalled();
  });

  it('engole P2002 (já suprimida) mas relança outros erros', async () => {
    const { svc: svcDup, prisma: prismaDup } = makeSvc();
    prismaDup.suppressedLink.create.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError('dup', {
        code: 'P2002',
        clientVersion: 'x',
      }),
    );
    await expect(
      svcDup.suppressEdge('p1', 'docs/a.md', 'docs/b.md'),
    ).resolves.toBeUndefined();
    expect(prismaDup.docLink.deleteMany).toHaveBeenCalled();

    const { svc: svcDown, prisma: prismaDown } = makeSvc();
    prismaDown.suppressedLink.create.mockRejectedValueOnce(
      new Error('db down'),
    );
    await expect(
      svcDown.suppressEdge('p1', 'docs/a.md', 'docs/b.md'),
    ).rejects.toThrow('db down');
  });
});
