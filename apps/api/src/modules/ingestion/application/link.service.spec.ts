import { LinkService } from './link.service';

function makePrisma(docs: { id: string; path: string; content: string }[]) {
  return {
    document: {
      findMany: jest.fn().mockResolvedValue(docs),
    },
    docLink: {
      deleteMany: jest.fn().mockResolvedValue({}),
      createMany: jest.fn().mockResolvedValue({}),
    },
    $transaction: jest.fn().mockImplementation((ops: Promise<unknown>[]) => Promise.all(ops)),
  } as any;
}

describe('LinkService.rebuildLinks', () => {
  it('apaga só as arestas explicit (preserva inferred)', async () => {
    const prisma = makePrisma([
      { id: 'd1', path: 'docs/a.md', content: '[link](./b.md)' },
      { id: 'd2', path: 'docs/b.md', content: '' },
    ]);
    const svc = new LinkService(prisma);

    await svc.rebuildLinks('p1');

    expect(prisma.docLink.deleteMany).toHaveBeenCalledWith({
      where: { projectId: 'p1', kind: 'explicit' },
    });
  });

  it('não inclui deleteMany sem filtro de kind (regressão do replace-all total)', async () => {
    const prisma = makePrisma([{ id: 'd1', path: 'docs/a.md', content: '' }]);
    const svc = new LinkService(prisma);

    await svc.rebuildLinks('p1');

    expect(prisma.docLink.deleteMany).not.toHaveBeenCalledWith({ where: { projectId: 'p1' } });
  });
});
