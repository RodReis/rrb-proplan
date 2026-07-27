/**
 * Máscaras dos campos de telefone, valor e data do briefing (pt-BR).
 *
 * Funções puras, fora do React, pelo mesmo motivo do `clientDetailView.ts`: o que
 * erra aqui erra **em silêncio**. Uma máscara que perde o último dígito, ou que
 * trava a digitação quando a pessoa apaga no meio, passa por revisão visual —
 * quem testa digita uma vez, do início ao fim, e nunca vê o defeito.
 *
 * **Formatam, não validam.** O servidor aceita estes três campos como texto livre
 * (`briefing-steps.ts`), e é ele a barreira. Máscara que recusa entrada
 * transformaria conveniência de digitação em bloqueio de envio — um telefone
 * estrangeiro, ou um "a combinar" no orçamento, não podem impedir o briefing de
 * ser enviado.
 */

/** Só os dígitos — a base de toda máscara daqui. */
function digits(value: string): string {
  return value.replace(/\D/g, '');
}

/**
 * Telefone brasileiro: `(62) 98525-0959` (celular, 11) ou `(62) 8525-0959`
 * (fixo, 10).
 *
 * Formata **progressivamente**: cada tecla mostra o resultado parcial, sem
 * esperar o número completo. O corte em 11 dígitos é o teto do padrão nacional —
 * o que passar disso é engano de digitação, e deixar entrar produziria um
 * `(62) 98525-09591` que ninguém percebe estar errado.
 */
export function maskPhone(value: string): string {
  const d = digits(value).slice(0, 11);
  if (d.length === 0) return '';
  if (d.length <= 2) return `(${d}`;

  const ddd = d.slice(0, 2);
  const rest = d.slice(2);
  // 11 dígitos = celular (9 no número), 10 = fixo (8). O hífen anda junto.
  const split = rest.length > 8 ? 5 : 4;
  if (rest.length <= split) return `(${ddd}) ${rest}`;
  return `(${ddd}) ${rest.slice(0, split)}-${rest.slice(split)}`;
}

/**
 * Valor em reais: `R$ 12.500,00`.
 *
 * Os dígitos entram **pela direita**, como em caixa de supermercado: digitar
 * `12500` mostra `R$ 125,00`. É o comportamento que não exige explicar onde fica
 * a vírgula — e o que evita o clássico erro de mil vezes o valor pretendido.
 *
 * O teto de 15 dígitos existe para o número caber em `Number` sem perder
 * precisão quando alguém segurar a tecla.
 */
export function maskCurrency(value: string): string {
  const d = digits(value).slice(0, 15);
  if (d.length === 0) return '';

  const cents = d.padStart(3, '0');
  const whole = cents.slice(0, -2).replace(/^0+(?=\d)/, '');
  const fraction = cents.slice(-2);
  return `R$ ${whole.replace(/\B(?=(\d{3})+(?!\d))/g, '.')},${fraction}`;
}

/**
 * Data no formato brasileiro: `dd/mm/aaaa`.
 *
 * Texto mascarado em vez de `<input type="date">` **de propósito**: o campo é
 * opcional e a spec chama de *data desejada*. O date picker nativo exige uma data
 * exata e válida; quem responde muitas vezes só sabe "março de 2027". Aqui a
 * pessoa digita o que sabe, e o campo continua sendo texto livre no contrato.
 *
 * Não valida o calendário: `31/02/2027` passa. Recusar exigiria decidir o que
 * fazer com data parcial durante a digitação — e `31/0` seria inválido no meio de
 * `31/03/2027`, travando quem digita corretamente.
 */
export function maskDate(value: string): string {
  const d = digits(value).slice(0, 8);
  if (d.length <= 2) return d;
  if (d.length <= 4) return `${d.slice(0, 2)}/${d.slice(2)}`;
  return `${d.slice(0, 2)}/${d.slice(2, 4)}/${d.slice(4)}`;
}

export type MaskName = 'phone' | 'currency' | 'date';

const MASKS: Record<MaskName, (value: string) => string> = {
  phone: maskPhone,
  currency: maskCurrency,
  date: maskDate,
};

export function applyMask(name: MaskName, value: string): string {
  return MASKS[name](value);
}

/** `inputMode` de cada máscara — abre o teclado numérico no celular. */
export const MASK_INPUT_MODE: Record<MaskName, 'tel' | 'numeric'> = {
  phone: 'tel',
  currency: 'numeric',
  date: 'numeric',
};

/** Placeholder de cada máscara — mostra o formato antes da primeira tecla. */
export const MASK_PLACEHOLDER: Record<MaskName, string> = {
  phone: '(62) 98525-0959',
  currency: 'R$ 0,00',
  date: 'dd/mm/aaaa',
};
