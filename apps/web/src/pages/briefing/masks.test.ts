import { describe, expect, it } from 'vitest';
import { maskCurrency, maskDate, maskPhone } from './masks';

describe('maskPhone', () => {
  it('formata celular de 11 dígitos', () => {
    expect(maskPhone('62985250959')).toBe('(62) 98525-0959');
  });

  it('formata fixo de 10 dígitos com 4 antes do hífen', () => {
    expect(maskPhone('6285250959')).toBe('(62) 8525-0959');
  });

  /**
   * Digitação parcial: cada tecla mostra o resultado até ali.
   *
   * Até o 10º dígito o número ainda pode virar fixo, então o hífen cai depois de
   * 4 — e **anda** para depois de 5 quando o 11º dígito chega e resolve a
   * ambiguidade. É o mesmo comportamento dos formulários bancários brasileiros.
   */
  it('formata progressivamente enquanto digita', () => {
    expect(maskPhone('')).toBe('');
    expect(maskPhone('6')).toBe('(6');
    expect(maskPhone('62')).toBe('(62');
    expect(maskPhone('629')).toBe('(62) 9');
    expect(maskPhone('629852')).toBe('(62) 9852');
    expect(maskPhone('6298525')).toBe('(62) 9852-5');
    expect(maskPhone('6298525095')).toBe('(62) 9852-5095');
    expect(maskPhone('62985250959')).toBe('(62) 98525-0959');
  });

  // O caso que revisão visual não pega: quem testa digita do início ao fim.
  it('reformata ao apagar no meio, sem travar', () => {
    // Apagou o último dígito do celular: volta a caber em fixo, hífen recua.
    expect(maskPhone('(62) 98525-095')).toBe('(62) 9852-5095');
    expect(maskPhone('(62) 9852')).toBe('(62) 9852');
    expect(maskPhone('(6')).toBe('(6');
  });

  it('ignora letras e símbolos digitados', () => {
    expect(maskPhone('62abc98525def0959')).toBe('(62) 98525-0959');
  });

  // Sem o corte, um dígito a mais passaria despercebido no fim do número.
  it('corta no 11º dígito, o teto do padrão nacional', () => {
    expect(maskPhone('629852509599999')).toBe('(62) 98525-0959');
  });
});

describe('maskCurrency', () => {
  // Entra pela direita, como caixa de supermercado.
  it('preenche os centavos primeiro', () => {
    expect(maskCurrency('')).toBe('');
    expect(maskCurrency('1')).toBe('R$ 0,01');
    expect(maskCurrency('12')).toBe('R$ 0,12');
    expect(maskCurrency('123')).toBe('R$ 1,23');
  });

  it('separa milhar com ponto', () => {
    expect(maskCurrency('1250000')).toBe('R$ 12.500,00');
    expect(maskCurrency('100000000')).toBe('R$ 1.000.000,00');
  });

  it('não deixa zero à esquerda sobrar na parte inteira', () => {
    expect(maskCurrency('000123')).toBe('R$ 1,23');
  });

  it('reaplica sobre valor já mascarado (digitação contínua)', () => {
    expect(maskCurrency('R$ 12.500,00')).toBe('R$ 12.500,00');
  });

  it('apagar dígito reduz o valor em vez de travar', () => {
    expect(maskCurrency('R$ 12.500,0')).toBe('R$ 1.250,00');
  });
});

describe('maskDate', () => {
  it('formata dd/mm/aaaa progressivamente', () => {
    expect(maskDate('')).toBe('');
    expect(maskDate('0')).toBe('0');
    expect(maskDate('15')).toBe('15');
    expect(maskDate('153')).toBe('15/3');
    expect(maskDate('1503')).toBe('15/03');
    expect(maskDate('15032027')).toBe('15/03/2027');
  });

  it('reaplica sobre valor já mascarado', () => {
    expect(maskDate('15/03/2027')).toBe('15/03/2027');
  });

  it('corta o que passa de 8 dígitos', () => {
    expect(maskDate('150320279999')).toBe('15/03/2027');
  });

  /**
   * Não valida calendário de propósito: recusar exigiria decidir o que fazer com
   * data parcial, e `31/0` é inválido no meio de `31/03/2027` — travaria quem
   * está digitando certo.
   */
  it('não recusa data impossível — máscara formata, não valida', () => {
    expect(maskDate('31022027')).toBe('31/02/2027');
  });
});
