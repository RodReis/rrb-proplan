import { ArtifactsSummaryService } from './artifacts-summary.service';

const TENANT = 't1';

function prismaFake(): any {
  return { artifact: { findMany: jest.fn().mockResolvedValue([]) } };
}

describe('ArtifactsSummaryService (SPEC-035)', () => {
  it('lista só o que está em PENDING_REVIEW, do tenant, com projeto vivo', async () => {
    const prisma = prismaFake();

    await new ArtifactsSummaryService(prisma).pendingReview(TENANT);

    const where = prisma.artifact.findMany.mock.calls[0][0].where;
    expect(where.tenantId).toBe(TENANT);
    expect(where.state).toBe('PENDING_REVIEW');
    expect(where.clientProject).toEqual({ deletedAt: null, client: { deletedAt: null } });
  });

  it('FAILED não entra — run que falhou espera nova tentativa, não revisão', async () => {
    // Misturá-los inflaria o contador com trabalho que ninguém consegue fazer
    // clicando em "revisar".
    const prisma = prismaFake();

    await new ArtifactsSummaryService(prisma).pendingReview(TENANT);

    expect(prisma.artifact.findMany.mock.calls[0][0].where.state).not.toEqual({
      in: expect.anything(),
    });
  });

  it('devolve o artefato com projeto e tipo — a lista é acionável', async () => {
    const prisma = prismaFake();
    prisma.artifact.findMany.mockResolvedValue([
      {
        id: 'a1',
        clientProjectId: 'cp1',
        kind: 'SCOPE',
        createdAt: new Date('2026-08-01T10:00:00.000Z'),
        clientProject: { title: 'Loja nova' },
      },
    ]);

    const out = await new ArtifactsSummaryService(prisma).pendingReview(TENANT);

    expect(out).toEqual([
      {
        artifactId: 'a1',
        clientProjectId: 'cp1',
        title: 'Loja nova',
        kind: 'SCOPE',
        since: '2026-08-01T10:00:00.000Z',
      },
    ]);
  });

  it('nada pendente devolve lista vazia, não erro', async () => {
    expect(await new ArtifactsSummaryService(prismaFake()).pendingReview(TENANT)).toEqual(
      [],
    );
  });
});
