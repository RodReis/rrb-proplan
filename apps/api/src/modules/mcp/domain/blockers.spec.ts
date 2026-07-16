import { findBlockers, ConstraintView, RefusedField } from './blockers';

const vigente: ConstraintView = {
  statement: 'não mexer no schema de billing',
  paths: ['prisma/schema.prisma'],
  status: 'vigente',
};
const aRevalidar: ConstraintView = {
  statement: 'auth via GitHub App — não trocar',
  paths: ['docs/DECISIONS.md'],
  status: 'a-revalidar',
  url: 'https://github.com/o/r/blob/main/docs/CONTEXT.md',
};

describe('findBlockers (SPEC-016 §find_blockers)', () => {
  it('constraint a-revalidar vira blocker; vigente não trava', () => {
    const bs = findBlockers([vigente, aRevalidar], []);
    expect(bs).toHaveLength(1);
    expect(bs[0].kind).toBe('restrição-a-revalidar');
    expect(bs[0].status).toBe('a-revalidar');
    expect(bs[0].where.paths).toEqual(['docs/DECISIONS.md']);
  });

  it('campo recusado em architecture/decisions trava; entidade secundária não', () => {
    const refused: RefusedField[] = [
      { entity: 'architecture', field: 'presence', missing: { paths: ['docs/ARCHITECTURE.md'] } },
      { entity: 'skills', field: 'presence', missing: { path: 'docs/SKILLS.md' } },
    ];
    const bs = findBlockers([], refused);
    expect(bs).toHaveLength(1);
    expect(bs[0].kind).toBe('decisão-ausente');
    expect(bs[0].where.paths).toEqual(['docs/ARCHITECTURE.md']);
  });

  it('sem constraint a-revalidar e sem campo estrutural recusado → vazio', () => {
    expect(findBlockers([vigente], [])).toEqual([]);
  });
});
