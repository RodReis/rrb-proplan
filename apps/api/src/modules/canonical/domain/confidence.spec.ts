import { computeConfidence, belowThreshold, ConfidenceSignals } from './confidence';

const base: ConfidenceSignals = {
  stalenessDays: 0,
  cobertura: 1,
  contradicao: 0,
  drift: 0,
};

describe('computeConfidence — determinístico (ADR-012)', () => {
  it('mesmos sinais → mesmo score, sempre (determinismo)', () => {
    const a = computeConfidence(base);
    const b = computeConfidence({ ...base });
    expect(a.score).toBe(b.score);
    expect(a.math).toEqual(b.math);
  });

  it('cobertura total + docs frescos → score alto (perto de 1)', () => {
    const { score } = computeConfidence({ stalenessDays: 0, cobertura: 1, contradicao: 0, drift: 0 });
    expect(score).toBeGreaterThan(0.9);
  });

  it('cobertura zero → score baixo, independente do resto', () => {
    const { score } = computeConfidence({ stalenessDays: 0, cobertura: 0, contradicao: 0, drift: 0 });
    expect(score).toBeLessThan(0.4);
  });

  it('staleness alto derruba o score mesmo com cobertura cheia', () => {
    const fresco = computeConfidence({ ...base, stalenessDays: 0 }).score;
    const velho = computeConfidence({ ...base, stalenessDays: 180 }).score;
    expect(velho).toBeLessThan(fresco);
  });

  it('staleness satura (não fica negativo em valores extremos)', () => {
    const { score } = computeConfidence({ ...base, stalenessDays: 100000 });
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(1);
  });

  it('score sempre em [0,1]', () => {
    for (const s of [0, 30, 90, 365]) {
      for (const c of [0, 0.3, 0.5, 1]) {
        const { score } = computeConfidence({ stalenessDays: s, cobertura: c, contradicao: 0, drift: 0 });
        expect(score).toBeGreaterThanOrEqual(0);
        expect(score).toBeLessThanOrEqual(1);
      }
    }
  });

  it('a conta (math) traz os 4 sinais que somam no número', () => {
    const { math } = computeConfidence({ stalenessDays: 42, cobertura: 0.7, contradicao: 0, drift: 0 });
    expect(math).toHaveProperty('stalenessDays', 42);
    expect(math).toHaveProperty('cobertura', 0.7);
    expect(math).toHaveProperty('contradicao', 0);
    expect(math).toHaveProperty('drift', 0);
  });

  it('slots contradicao/drift têm peso ZERO nesta fatia (decisão 2 do PI)', () => {
    // Variar contradicao/drift NÃO muda o score — são slots extensíveis, peso 0.
    const semContra = computeConfidence({ ...base, cobertura: 0.6, contradicao: 0, drift: 0 }).score;
    const comContra = computeConfidence({ ...base, cobertura: 0.6, contradicao: 5, drift: 3 }).score;
    expect(comContra).toBe(semContra);
  });
});

describe('belowThreshold — recusa', () => {
  it('score < limiar → true (recusa)', () => {
    expect(belowThreshold(0.3, 0.4)).toBe(true);
  });
  it('score >= limiar → false', () => {
    expect(belowThreshold(0.4, 0.4)).toBe(false);
    expect(belowThreshold(0.9, 0.4)).toBe(false);
  });
  it('limiar 0 desliga a recusa (mostra tudo)', () => {
    expect(belowThreshold(0, 0)).toBe(false);
    expect(belowThreshold(0.01, 0)).toBe(false);
  });
});
