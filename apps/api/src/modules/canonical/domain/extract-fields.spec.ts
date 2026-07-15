import { extractCanonicalFields, ResolutionInput, stalenessDaysBetween } from './extract-fields';

const HASH = 'scope-abc';

function res(over: Partial<ResolutionInput>): ResolutionInput {
  return {
    entity: 'architecture',
    level: 1,
    source: 'convention',
    path: 'docs/ARCHITECTURE.md',
    paths: [],
    sha: 'blob-sha',
    ...over,
  };
}

describe('stalenessDaysBetween', () => {
  it('gap positivo em dias (código à frente dos docs)', () => {
    const docs = new Date('2026-06-01T00:00:00Z');
    const code = new Date('2026-07-01T00:00:00Z');
    expect(stalenessDaysBetween(docs, code)).toBe(30);
  });
  it('docs à frente do código → 0 (nunca negativo)', () => {
    const docs = new Date('2026-07-01T00:00:00Z');
    const code = new Date('2026-06-01T00:00:00Z');
    expect(stalenessDaysBetween(docs, code)).toBe(0);
  });
  it('datas nulas → 0 (sem sinal, não penaliza)', () => {
    expect(stalenessDaysBetween(null, new Date())).toBe(0);
    expect(stalenessDaysBetween(new Date(), null)).toBe(0);
    expect(stalenessDaysBetween(null, null)).toBe(0);
  });
});

describe('extractCanonicalFields — determinístico, campo presence por entidade', () => {
  it('entidade resolvida → provenance fato, value com path, confiança > 0', () => {
    const fields = extractCanonicalFields({
      resolutions: [res({ entity: 'architecture', level: 1, path: 'docs/ARCHITECTURE.md' })],
      stalenessDays: 0,
      docsScopeHash: HASH,
      docsDate: '2026-07-14',
    });
    const arch = fields.find((f) => f.entity === 'architecture')!;
    expect(arch.field).toBe('presence');
    expect(arch.provenanceClass).toBe('fato');
    expect(arch.value).toMatchObject({ path: 'docs/ARCHITECTURE.md' });
    expect(arch.provenanceRef).toMatchObject({ path: 'docs/ARCHITECTURE.md', sha: 'blob-sha' });
    expect(arch.confidence).toBeGreaterThan(0);
    expect(arch.docsScopeHash).toBe(HASH);
  });

  it('entidade ausente (nível 4) → value null, provenanceRef {absent}, confiança 0', () => {
    const fields = extractCanonicalFields({
      resolutions: [res({ entity: 'testing', level: 4, source: 'absent', path: null, paths: [], sha: null })],
      stalenessDays: 0,
      docsScopeHash: HASH,
      docsDate: null,
    });
    const testing = fields.find((f) => f.entity === 'testing')!;
    expect(testing.value).toBeNull();
    expect(testing.provenanceRef).toMatchObject({ absent: true });
    expect(testing.confidence).toBe(0);
  });

  it('nível de resolução modula a cobertura: convenção(1) > alias(2) > inferência(3)', () => {
    const conv = extractCanonicalFields({ resolutions: [res({ level: 1, source: 'convention' })], stalenessDays: 0, docsScopeHash: HASH, docsDate: null })[0];
    const alias = extractCanonicalFields({ resolutions: [res({ level: 2, source: 'alias' })], stalenessDays: 0, docsScopeHash: HASH, docsDate: null })[0];
    const infer = extractCanonicalFields({ resolutions: [res({ level: 3, source: 'inference' })], stalenessDays: 0, docsScopeHash: HASH, docsDate: null })[0];
    expect(conv.confidence).toBeGreaterThan(alias.confidence);
    expect(alias.confidence).toBeGreaterThan(infer.confidence);
  });

  it('inferência (nível 3) → provenance inferencia, não fato', () => {
    const f = extractCanonicalFields({ resolutions: [res({ level: 3, source: 'inference' })], stalenessDays: 0, docsScopeHash: HASH, docsDate: null })[0];
    expect(f.provenanceClass).toBe('inferencia');
  });

  it('coleção (paths) → value carrega os paths', () => {
    const f = extractCanonicalFields({
      resolutions: [res({ entity: 'decisions', level: 2, source: 'alias', path: null, paths: ['adr/1.md', 'adr/2.md'], sha: null })],
      stalenessDays: 0,
      docsScopeHash: HASH,
      docsDate: null,
    })[0];
    expect(f.value).toMatchObject({ paths: ['adr/1.md', 'adr/2.md'] });
  });

  it('determinismo: mesmos inputs → linhas idênticas', () => {
    const input = { resolutions: [res({}), res({ entity: 'deploy', level: 4, source: 'absent', path: null, sha: null })], stalenessDays: 42, docsScopeHash: HASH, docsDate: null };
    expect(extractCanonicalFields(input)).toEqual(extractCanonicalFields(input));
  });

  it('staleness derruba a confiança de todas as entidades igualmente', () => {
    const fresco = extractCanonicalFields({ resolutions: [res({})], stalenessDays: 0, docsScopeHash: HASH, docsDate: null })[0];
    const velho = extractCanonicalFields({ resolutions: [res({})], stalenessDays: 180, docsScopeHash: HASH, docsDate: null })[0];
    expect(velho.confidence).toBeLessThan(fresco.confidence);
  });
});
