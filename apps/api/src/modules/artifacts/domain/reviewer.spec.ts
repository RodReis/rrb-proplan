import {
  InvalidReviewError,
  REVIEWER_SYSTEM,
  buildReviewUser,
  parseReview,
} from './reviewer';

const valido = {
  veredito: 'atenção',
  justificativa: 'O escopo cita integração que o briefing não menciona.',
  pontos: ['conferir se a integração foi pedida'],
};

describe('parseReview (SPEC-032 §2.9)', () => {
  it('aceita JSON cercado e com prosa em volta', () => {
    const texto = 'Claro!\n```json\n' + JSON.stringify(valido) + '\n```';
    expect(parseReview(texto)).toEqual(valido);
  });

  it('aceita lista de pontos vazia', () => {
    // Vazia é resultado, não falha: um artefato sem problema não deve forçar o
    // modelo a inventar um ponto de atenção para satisfazer o schema.
    const texto = JSON.stringify({ ...valido, pontos: [] });
    expect(parseReview(texto).pontos).toEqual([]);
  });

  it('recusa veredito vazio', () => {
    const texto = JSON.stringify({ ...valido, veredito: '  ' });
    expect(() => parseReview(texto)).toThrow(/veredito/);
  });

  it('recusa justificativa ausente', () => {
    const texto = JSON.stringify({ veredito: 'ok', pontos: [] });
    expect(() => parseReview(texto)).toThrow(/justificativa/);
  });

  it('recusa pontos que não é lista de textos', () => {
    const texto = JSON.stringify({ ...valido, pontos: [{ x: 1 }] });
    expect(() => parseReview(texto)).toThrow(InvalidReviewError);
  });
});

describe('REVIEWER_SYSTEM: anota, nunca bloqueia (decisão 1 do PI)', () => {
  it('diz explicitamente ao modelo que ele NÃO decide a aprovação', () => {
    // A instrução no prompt não é o mecanismo — o mecanismo é o código nunca
    // consultar o veredito. Mas um prompt que peça um julgamento binário faria
    // o parecer PARECER um gate na tela, e a pessoa deixaria de decidir.
    expect(REVIEWER_SYSTEM).toMatch(/NÃO decide se o artefato é aprovado/);
  });

  it('o veredito é texto livre, não uma lista fechada', () => {
    // Um enum com valor 'reject' seria convite a `WHERE verdict <> 'reject'` no
    // caminho da aprovação — o veto que a decisão 1 recusa.
    expect(REVIEWER_SYSTEM).not.toMatch(/"aprovado" \| "reprovado"/);
    expect(REVIEWER_SYSTEM).toMatch(/uma palavra ou expressão curta/);
  });

  it('proíbe estimar horas, prazos e preços como as demais capacidades', () => {
    expect(REVIEWER_SYSTEM).toMatch(/NÃO estime horas, prazos ou preços/);
  });
});

describe('buildReviewUser', () => {
  it('leva o briefing E o artefato sob revisão', () => {
    // Sem o briefing, o revisor não tem como apontar "o artefato afirma o que o
    // briefing não diz" — que é o achado mais útil que ele produz.
    const msg = buildReviewUser('scope', { 1: { produto: 'site' } }, { entregaveis: ['x'] });

    expect(msg).toContain('Briefing do cliente');
    expect(msg).toContain('Artefato gerado (scope)');
    expect(msg).toContain('entregaveis');
  });
});
