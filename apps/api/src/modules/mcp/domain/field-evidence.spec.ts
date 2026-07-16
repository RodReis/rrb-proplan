import { fieldToEvidence } from './field-evidence';

describe('fieldToEvidence (SPEC-016 §2 — a marca a-revalidar nunca some)', () => {
  it('asserção a-revalidar → status propagado, sempre', () => {
    const e = fieldToEvidence('assercao', {
      author: 'rodrigo',
      date: '2026-06-10',
      sha: 'd4e5f6',
      paths: ['docs/CONTEXT.md'],
      status: 'a-revalidar',
    });
    expect(e.type).toBe('asserção');
    expect(e.status).toBe('a-revalidar');
    expect(e.author).toBe('rodrigo');
    expect(e.path).toBe('docs/CONTEXT.md');
  });

  it('asserção vigente → status vigente propagado', () => {
    expect(fieldToEvidence('assercao', { status: 'vigente' }).status).toBe('vigente');
  });

  it('fato com path+sha+date', () => {
    const e = fieldToEvidence('fato', { path: 'docs/DECISIONS.md', sha: 'a1b2c3', date: '2026-05-04' });
    expect(e).toMatchObject({ type: 'fato', path: 'docs/DECISIONS.md', sha: 'a1b2c3', date: '2026-05-04' });
    expect(e.status).toBeUndefined();
  });

  it('inferencia e hipotese mapeiam para inferência', () => {
    expect(fieldToEvidence('inferencia', {}).type).toBe('inferência');
    expect(fieldToEvidence('hipotese', {}).type).toBe('inferência');
  });

  it('ref nulo não quebra', () => {
    expect(fieldToEvidence('fato', null).type).toBe('fato');
  });
});
