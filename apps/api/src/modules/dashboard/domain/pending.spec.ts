import { PENDING_KINDS, isPendingKind } from './pending';

/**
 * A lista fechada de 4 itens (SPEC-035 §2.3, decisão 3 do PI).
 *
 * Padrão da allowlist do PR-4 da SPEC-033, que o critério de aceite cita por
 * nome: constante nomeada, com teste do conteúdo. Um 5º tipo entrar sem decisão
 * do PI quebra este teste antes de chegar na tela.
 */
describe('dashboard: os 4 tipos de "Esperando você" (SPEC-035 §2.3)', () => {
  it('são exatamente estes 4, nesta ordem', () => {
    expect(PENDING_KINDS).toEqual([
      'artifact_review',
      'estimate',
      'contract_acceptance',
      'stalled',
    ]);
  });

  it('nenhum 5º tipo entra sem decisão do PI', () => {
    expect(PENDING_KINDS).toHaveLength(4);
    expect(isPendingKind('artifact_review')).toBe(true);
    expect(isPendingKind('briefing_late')).toBe(false);
    expect(isPendingKind('')).toBe(false);
  });
});
