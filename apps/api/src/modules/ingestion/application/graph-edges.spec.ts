import { IngestionService } from './ingestion.service';

function makeSvc(overrides: any = {}) {
  const prisma = {
    project: { findFirst: jest.fn().mockResolvedValue({ id: 'p1' }) },
    document: { findMany: jest.fn().mockResolvedValue(overrides.docs ?? []) },
    docLink: { findMany: jest.fn().mockResolvedValue(overrides.links ?? []) },
  };
  return { svc: new IngestionService(prisma as any, {} as any, {} as any, {} as any), prisma };
}

describe('IngestionService.graph — edges com kind/reason', () => {
  it('graph edges trazem kind e reason', async () => {
    const { svc } = makeSvc({
      docs: [{ id: 'a', path: 'docs/a.md', isConventional: false }],
      links: [
        {
          sourceDocumentId: 'a',
          targetDocumentId: 'b',
          targetPath: 'docs/b.md',
          kind: 'inferred',
          reason: 'X',
        },
      ],
    });
    const out = await svc.graph('u1', 'p1');
    expect(out.edges[0]).toMatchObject({ kind: 'inferred', reason: 'X' });
  });

  it('aresta explícita traz reason null', async () => {
    const { svc } = makeSvc({
      docs: [{ id: 'a', path: 'docs/a.md', isConventional: false }],
      links: [
        {
          sourceDocumentId: 'a',
          targetDocumentId: 'b',
          targetPath: 'docs/b.md',
          kind: 'explicit',
          reason: null,
        },
      ],
    });
    const out = await svc.graph('u1', 'p1');
    expect(out.edges[0]).toMatchObject({ kind: 'explicit', reason: null });
  });
});
