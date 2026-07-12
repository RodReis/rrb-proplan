import { InvalidSummaryError, parseSummary } from './summary';

describe('parseSummary', () => {
  const valid = {
    oQueE: 'Um painel de gestão.',
    ondeParou: 'Fatia 2 concluída.',
    oQueFalta: ['Kanban', 'Grafo'],
  };

  it('parseia JSON puro', () => {
    expect(parseSummary(JSON.stringify(valid))).toEqual(valid);
  });

  it('parseia JSON dentro de cerca ```json', () => {
    const text = 'Aqui está:\n```json\n' + JSON.stringify(valid) + '\n```\n';
    expect(parseSummary(text)).toEqual(valid);
  });

  it('parseia com prosa antes e depois', () => {
    const text = `Claro! ${JSON.stringify(valid)} Espero ter ajudado.`;
    expect(parseSummary(text)).toEqual(valid);
  });

  it('aceita oQueFalta vazio', () => {
    const v = { ...valid, oQueFalta: [] };
    expect(parseSummary(JSON.stringify(v))).toEqual(v);
  });

  it('lança quando não há JSON', () => {
    expect(() => parseSummary('sem json aqui')).toThrow(InvalidSummaryError);
  });

  it('lança quando falta uma chave', () => {
    expect(() => parseSummary('{"oQueE":"x","ondeParou":"y"}')).toThrow(
      InvalidSummaryError,
    );
  });

  it('lança quando oQueFalta não é array de strings', () => {
    const bad = JSON.stringify({ ...valid, oQueFalta: [1, 2] });
    expect(() => parseSummary(bad)).toThrow(InvalidSummaryError);
  });

  it('lança quando oQueE é vazio', () => {
    const bad = JSON.stringify({ ...valid, oQueE: '  ' });
    expect(() => parseSummary(bad)).toThrow(InvalidSummaryError);
  });

  it('lança em JSON malformado', () => {
    expect(() => parseSummary('{ oQueE: sem aspas }')).toThrow(
      InvalidSummaryError,
    );
  });

  it('lida com chaves aninhadas/strings com } dentro', () => {
    const v = { ...valid, ondeParou: 'usa {chaves} no texto' };
    expect(parseSummary(JSON.stringify(v))).toEqual(v);
  });
});
