import { assembleCanonicalModel, CanonicalFieldRow } from './canonical-model';

function row(over: Partial<CanonicalFieldRow>): CanonicalFieldRow {
  return {
    entity: 'architecture',
    field: 'presence',
    value: { path: 'docs/ARCHITECTURE.md' },
    provenanceClass: 'fato',
    provenanceRef: { path: 'docs/ARCHITECTURE.md', sha: 'abc', date: '2026-07-14' },
    confidence: 0.9,
    confidenceMath: { stalenessDays: 0, cobertura: 1, contradicao: 0, drift: 0 },
    ...over,
  };
}

describe('assembleCanonicalModel — projeção de leitura pura', () => {
  it('agrupa campos por entidade, cada um com proveniência + confiança + a conta', () => {
    const model = assembleCanonicalModel(
      [
        row({ entity: 'architecture', field: 'presence' }),
        row({ entity: 'deploy', field: 'presence', confidence: 0.5 }),
      ],
      0.4,
    );
    const arch = model.entities.architecture.fields.presence;
    expect(arch).toMatchObject({
      refused: false,
      provenance: 'fato',
      confidence: 0.9,
    });
    expect(arch).toHaveProperty('math.cobertura', 1);
    expect(model.entities.deploy.fields.presence).toMatchObject({ refused: false, confidence: 0.5 });
  });

  it('campo abaixo do limiar → recusa explícita, nunca palpite', () => {
    const model = assembleCanonicalModel(
      [row({ entity: 'testing', field: 'presence', value: null, confidence: 0.2, provenanceRef: { absent: true } })],
      0.4,
    );
    const testing = model.entities.testing.fields.presence;
    expect(testing.refused).toBe(true);
    if (testing.refused) {
      expect(testing.reason).toMatch(/ausente|defasado/i);
      expect(testing).toHaveProperty('missing');
    }
  });

  it('limiar 0 desliga a recusa — mostra tudo com a confiança crua', () => {
    const model = assembleCanonicalModel(
      [row({ entity: 'testing', field: 'presence', confidence: 0.1 })],
      0,
    );
    expect(model.entities.testing.fields.presence.refused).toBe(false);
    expect(model.entities.testing.fields.presence).toMatchObject({ confidence: 0.1 });
  });

  it('recusa preserva a conta (math) — a recusa também é auditável', () => {
    const model = assembleCanonicalModel(
      [row({ entity: 'deploy', field: 'presence', confidence: 0.15, confidenceMath: { stalenessDays: 200, cobertura: 0.3, contradicao: 0, drift: 0 } })],
      0.4,
    );
    const dep = model.entities.deploy.fields.presence;
    expect(dep.refused).toBe(true);
    expect(dep).toHaveProperty('math.stalenessDays', 200);
  });

  it('múltiplos campos na mesma entidade convivem', () => {
    const model = assembleCanonicalModel(
      [
        row({ entity: 'decisions', field: 'presence', confidence: 0.8 }),
        row({ entity: 'decisions', field: 'count', value: 12, confidence: 0.8 }),
      ],
      0.4,
    );
    expect(Object.keys(model.entities.decisions.fields).sort()).toEqual(['count', 'presence']);
  });

  it('entrada vazia → modelo sem entidades (não quebra)', () => {
    const model = assembleCanonicalModel([], 0.4);
    expect(model.entities).toEqual({});
  });

  it('projeção é pura: não muta as linhas de entrada', () => {
    const rows = [row({ entity: 'skills', field: 'presence' })];
    const snapshot = JSON.stringify(rows);
    assembleCanonicalModel(rows, 0.4);
    expect(JSON.stringify(rows)).toBe(snapshot);
  });
});
