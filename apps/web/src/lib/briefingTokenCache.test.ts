import { beforeEach, describe, expect, it } from 'vitest';
import { forgetToken, recallToken, rememberToken } from './briefingTokenCache';

describe('briefingTokenCache', () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  it('devolve o token guardado do projeto e null para quem não tem', () => {
    rememberToken('p1', 'abc123');
    expect(recallToken('p1')).toBe('abc123');
    expect(recallToken('p2')).toBeNull();
  });

  // Regenerar substitui: o anterior já foi revogado no servidor.
  it('regravar substitui o token do mesmo projeto', () => {
    rememberToken('p1', 'antigo');
    rememberToken('p1', 'novo');
    expect(recallToken('p1')).toBe('novo');
  });

  it('esquecer apaga só o projeto pedido', () => {
    rememberToken('p1', 'a');
    rememberToken('p2', 'b');
    forgetToken('p1');
    expect(recallToken('p1')).toBeNull();
    expect(recallToken('p2')).toBe('b');
  });

  it('esquecer projeto desconhecido não quebra', () => {
    expect(() => forgetToken('nunca-existiu')).not.toThrow();
  });

  // O que vem do storage é entrada não confiável.
  it('JSON corrompido degrada para "não lembro", não estoura', () => {
    sessionStorage.setItem('proplan:briefingTokens', '{ não é json');
    expect(recallToken('p1')).toBeNull();
  });

  it('descarta valores que não são string não-vazia', () => {
    sessionStorage.setItem(
      'proplan:briefingTokens',
      JSON.stringify({ p1: 42, p2: '', p3: 'ok' }),
    );
    expect(recallToken('p1')).toBeNull();
    expect(recallToken('p2')).toBeNull();
    expect(recallToken('p3')).toBe('ok');
  });

  // sessionStorage, não localStorage: o token é credencial, não preferência.
  it('grava em sessionStorage e não vaza para o localStorage', () => {
    rememberToken('p1', 'abc123');
    expect(sessionStorage.getItem('proplan:briefingTokens')).toContain('abc123');
    expect(localStorage.getItem('proplan:briefingTokens')).toBeNull();
  });
});
