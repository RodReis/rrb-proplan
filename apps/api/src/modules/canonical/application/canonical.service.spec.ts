import { CanonicalService } from './canonical.service';

function makeSvc(over: {
  project?: any;
  resolutions?: any[];
  shas?: Map<string, string>;
  threshold?: number;
  fieldRows?: any[];
  owner?: any;
  assertions?: any[];
} = {}) {
  const created: any[] = [];
  const prisma = {
    project: {
      findUnique: jest.fn().mockResolvedValue(
        over.project ?? {
          docsScopeHash: 'scope-1',
          lastDocsCommitAt: new Date('2026-07-10'),
          lastCodeCommitAt: new Date('2026-07-14'),
        },
      ),
      findFirst: jest.fn().mockResolvedValue('owner' in over ? over.owner : { id: 'p1' }),
    },
    canonicalField: {
      deleteMany: jest.fn().mockResolvedValue({}),
      createMany: jest.fn((arg: any) => { created.push(...arg.data); return Promise.resolve({}); }),
      findMany: jest.fn().mockResolvedValue(over.fieldRows ?? []),
    },
    $transaction: jest.fn((ops: any[]) => Promise.all(ops)),
  } as any;
  const resolution = {
    allResolutionsOf: jest.fn().mockResolvedValue(over.resolutions ?? []),
    docShasOf: jest.fn().mockResolvedValue(over.shas ?? new Map()),
  } as any;
  const settings = {
    canonicalThresholdOf: jest.fn().mockResolvedValue(over.threshold ?? 0.4),
  } as any;
  const context = {
    assertionsOf: jest.fn().mockResolvedValue((over as any).assertions ?? []),
  } as any;
  return { svc: new CanonicalService(prisma, resolution, settings, context), prisma, created };
}

describe('CanonicalService.rebuild', () => {
  it('persiste um campo presence por entidade (replace-all)', async () => {
    const { svc, prisma, created } = makeSvc({
      resolutions: [
        { entity: 'architecture', level: 1, source: 'convention', path: 'docs/ARCHITECTURE.md', paths: [], confidence: 1 },
        { entity: 'testing', level: 4, source: 'absent', path: null, paths: [], confidence: 0 },
      ],
      shas: new Map([['docs/ARCHITECTURE.md', 'sha-arch']]),
    });
    await svc.rebuild('p1');
    expect(prisma.canonicalField.deleteMany).toHaveBeenCalledWith({ where: { projectId: 'p1' } });
    expect(created).toHaveLength(2);
    const arch = created.find((f) => f.entity === 'architecture');
    expect(arch).toMatchObject({ field: 'presence', provenanceClass: 'fato', confidence: expect.any(Number) });
    expect(arch.provenanceRef).toMatchObject({ path: 'docs/ARCHITECTURE.md', sha: 'sha-arch' });
    const testing = created.find((f) => f.entity === 'testing');
    expect(testing.confidence).toBe(0);
    expect(testing.value).toBeNull();
  });

  it('projeto sumiu → não quebra (nada persistido)', async () => {
    const { svc, prisma } = makeSvc({ project: null });
    prisma.project.findUnique.mockResolvedValue(null);
    await svc.rebuild('p1');
    expect(prisma.canonicalField.deleteMany).not.toHaveBeenCalled();
  });

  it('reconstruível: mesma entrada → mesmas linhas (determinístico)', async () => {
    const args = {
      resolutions: [{ entity: 'deploy', level: 2, source: 'alias', path: 'docs/runbooks/x.md', paths: [], confidence: 0.8 }],
      shas: new Map([['docs/runbooks/x.md', 'sha-x']]),
    };
    const a = makeSvc(args); await a.svc.rebuild('p1');
    const b = makeSvc(args); await b.svc.rebuild('p1');
    // ignora nada volátil: docsDate vem de lastDocsCommitAt (fixo no mock)
    expect(a.created).toEqual(b.created);
  });

  it('projeta asserções em entity=constraints (SPEC-015): vigente 1.0, a-revalidar rebaixada', async () => {
    const { svc, created } = makeSvc({
      resolutions: [],
      assertions: [
        { statement: 'Não mexer no motor de folha', paths: ['lib/folha/'], author: 'rodrigo', assertedAt: '2026-06-12', assertedSha: 'a1b2c3d', status: 'vigente' },
        { statement: 'Módulo parece morto e não é', paths: ['src/legacy/'], author: 'rodrigo', assertedAt: '2026-05-01', assertedSha: 'ffff111', status: 'a-revalidar' },
      ],
    });
    await svc.rebuild('p1');
    const constraints = created.filter((f) => f.entity === 'constraints');
    expect(constraints).toHaveLength(2);
    expect(constraints[0]).toMatchObject({
      provenanceClass: 'assercao',
      confidence: 1,
    });
    expect(constraints[0].provenanceRef).toMatchObject({ author: 'rodrigo', sha: 'a1b2c3d', status: 'vigente' });
    // a-revalidar NUNCA é omitida — aparece rebaixada, com a marca na proveniência
    expect(constraints[1].confidence).toBe(0.5);
    expect(constraints[1].provenanceRef).toMatchObject({ status: 'a-revalidar' });
  });

  it('statements duplicados (CONTEXT.md editado à mão) → slugs desambiguados, rebuild não quebra', async () => {
    const dup = { paths: ['x/'], author: 'r', assertedAt: '2026-01-01', assertedSha: 's', status: 'vigente' };
    const { svc, created } = makeSvc({
      resolutions: [],
      assertions: [
        { ...dup, statement: 'Mesmo texto' },
        { ...dup, statement: 'Mesmo texto' },
      ],
    });
    await svc.rebuild('p1');
    const keys = created.filter((f) => f.entity === 'constraints').map((f) => f.field);
    expect(new Set(keys).size).toBe(2); // @@unique(projectId, entity, field) preservado
  });
});

describe('CanonicalService.getCanonicalModel', () => {
  const rows = [
    { entity: 'architecture', field: 'presence', value: { path: 'docs/ARCHITECTURE.md' }, provenanceClass: 'fato', provenanceRef: { path: 'docs/ARCHITECTURE.md' }, confidence: 0.9, confidenceMath: { stalenessDays: 4, cobertura: 1, contradicao: 0, drift: 0 } },
    { entity: 'testing', field: 'presence', value: null, provenanceClass: 'fato', provenanceRef: { absent: true }, confidence: 0.1, confidenceMath: { stalenessDays: 0, cobertura: 0, contradicao: 0, drift: 0 } },
  ];

  it('acima do limiar → campo presente; abaixo → recusa', async () => {
    const { svc } = makeSvc({ fieldRows: rows, threshold: 0.4 });
    const model = await svc.getCanonicalModel('u1', 'p1');
    expect(model.entities.architecture.fields.presence.refused).toBe(false);
    expect(model.entities.testing.fields.presence.refused).toBe(true);
  });

  it('limiar 0 → nada recusado (confiança crua)', async () => {
    const { svc } = makeSvc({ fieldRows: rows, threshold: 0 });
    const model = await svc.getCanonicalModel('u1', 'p1');
    expect(model.entities.testing.fields.presence.refused).toBe(false);
  });

  it('projeto de outro usuário → NotFound (ownership)', async () => {
    const { svc } = makeSvc({ owner: null });
    await expect(svc.getCanonicalModel('u1', 'p1')).rejects.toThrow(/não encontrado/i);
  });
});
