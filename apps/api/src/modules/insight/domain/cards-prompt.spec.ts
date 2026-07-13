import { parseCards } from './cards-prompt';

describe('parseCards', () => {
  it('parseia JSON válido', () => {
    const out = parseCards('{"cards":[{"title":"Login","column":"todo","priority":"alta"}]}');
    expect(out).toEqual([{ title: 'Login', column: 'todo', priority: 'alta' }]);
  });

  it('tolera cercas ```json do modelo', () => {
    const out = parseCards('```json\n{"cards":[{"title":"X","column":"done","priority":null}]}\n```');
    expect(out).toEqual([{ title: 'X', column: 'done', priority: null }]);
  });

  it('coluna inválida cai em backlog; prioridade inválida vira null', () => {
    const out = parseCards('{"cards":[{"title":"Y","column":"xpto","priority":"urgente"}]}');
    expect(out).toEqual([{ title: 'Y', column: 'backlog', priority: null }]);
  });

  it('lança quando não há array cards', () => {
    expect(() => parseCards('{"foo":1}')).toThrow('array "cards"');
  });

  it('lança em card sem título', () => {
    expect(() => parseCards('{"cards":[{"column":"todo"}]}')).toThrow('sem título');
  });

  it('apara espaços do título', () => {
    expect(parseCards('{"cards":[{"title":"  A  ","column":"todo","priority":null}]}')[0].title).toBe('A');
  });
});
