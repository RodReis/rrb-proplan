import {
  Candidate,
  EvidenceItem,
  enforceEvidenceContract,
} from './evidence-contract';

const fato: EvidenceItem = {
  type: 'fato',
  path: 'docs/DECISIONS.md',
  sha: 'a1b2c3',
  date: '2026-05-04',
};

describe('enforceEvidenceContract (invariante central — SPEC-016 §1)', () => {
  it('evidência vazia → recusa, NUNCA answer', () => {
    const c: Candidate = { answer: 'algo plausível', confidence: 0.9, evidence: [] };
    const r = enforceEvidenceContract(c);
    expect(r.refusal).not.toBeNull();
    expect(r.answer).toBeNull();
    expect(r.evidence).toEqual([]);
  });

  it('answer null → recusa mesmo com evidência (nada a afirmar)', () => {
    const c: Candidate = { answer: null, confidence: 0.9, evidence: [fato] };
    expect(enforceEvidenceContract(c).answer).toBeNull();
  });

  it('recusa pré-computada (abaixo do limiar) → recusa mesmo com evidência', () => {
    const c: Candidate = {
      answer: 'chute',
      confidence: 0.2,
      evidence: [fato],
      refusalReason: { reason: 'confiança abaixo do limiar', missing: 'doc atualizado' },
    };
    const r = enforceEvidenceContract(c);
    expect(r.answer).toBeNull();
    expect(r.refusal?.reason).toBe('confiança abaixo do limiar');
  });

  it('answer + evidência + sem motivo de recusa → responde com a prova', () => {
    const c: Candidate = { answer: 'a arquitetura é X', confidence: 0.82, evidence: [fato] };
    const r = enforceEvidenceContract(c);
    expect(r.answer).toBe('a arquitetura é X');
    expect(r.evidence).toHaveLength(1);
    expect(r.refusal).toBeNull();
  });

  it('a recusa carrega o que falta, nunca um palpite', () => {
    const c: Candidate = { answer: null, confidence: 0, evidence: [] };
    const r = enforceEvidenceContract(c);
    expect(r.refusal?.missing).toBeTruthy();
  });
});
