/**
 * O cap de payload do relato de erro (SPEC-043 §Escopo) — **trunca, nunca
 * rejeita**.
 *
 * ## Por que rejeitar seria o defeito
 *
 * O relato grande é o relato do crash de verdade: stack fundo, sessão longa,
 * usuário que escreveu três parágrafos porque estava irritado. Um `413` faria
 * justamente esses nunca chegarem, e a aba de erros mostraria só os casos
 * pequenos — dando a impressão de que o app quebra pouco e de leve. A spec é
 * explícita: *"nunca rejeição por tamanho"*.
 *
 * ## A ordem do sacrifício não é arbitrária
 *
 * `sessionTail` sai inteiro primeiro: é o maior, o mais barato de perder e o
 * único que carrega o risco de privacidade que o PI aceitou sob mitigação
 * (nomes de arquivos do projeto do usuário). Depois `stack`, depois `userNote`,
 * e `message` **nunca** — sem ela o relato não tem como ser agrupado nem lido,
 * e uma linha sem mensagem é uma linha que o admin não consegue usar para nada.
 *
 * Funções puras, sem Prisma nem Nest: o cap é uma decisão sobre dados, e testá-la
 * não deve exigir banco.
 */

/** 256 KB (§Escopo). Medido em bytes UTF-8, não em caracteres — é o tamanho que
 *  de fato trafega e o de fato ocupa. */
export const MAX_PAYLOAD_BYTES = 256 * 1024;

/**
 * Teto próprio da mensagem, aplicado **antes** do cap global. Existe porque
 * `message` é o campo que nunca é sacrificado: sem um limite dele, um cliente
 * mandando 1 MB numa `message` só deixaria o cap global sem nada para cortar.
 */
export const MAX_MESSAGE_BYTES = 4 * 1024;

export interface RelatoTruncavel {
  message: string;
  stack: string | null;
  userNote: string | null;
  sessionTail: unknown;
}

export interface RelatoTruncado extends RelatoTruncavel {
  /** O chamador loga; a aba de erros um dia pode mostrar. */
  truncated: boolean;
}

/** Bytes UTF-8 de uma string. `length` conta unidades UTF-16 e erraria para
 *  acento, emoji e qualquer coisa fora do ASCII — que é o conteúdo normal de um
 *  relato em português. */
export function bytes(valor: string): number {
  return Buffer.byteLength(valor, 'utf8');
}

/**
 * Corta uma string no limite de **bytes** sem partir um caractere no meio.
 *
 * `slice` por índice de caractere não serve: cortar em 1024 caracteres pode dar
 * 3 KB, e cortar bytes crus produziria o `U+FFFD` que aparece como losango preto
 * no meio da stack. O `TextDecoder` sem `fatal` resolve descartando a sequência
 * incompleta da ponta.
 */
export function cortarBytes(valor: string, limite: number): string {
  if (bytes(valor) <= limite) return valor;
  const cru = Buffer.from(valor, 'utf8').subarray(0, limite);
  return new TextDecoder('utf-8').decode(cru).replace(/�+$/, '');
}

/**
 * Aplica o cap ao relato inteiro, sacrificando na ordem descrita acima.
 *
 * Devolve um relato novo — nunca muta a entrada.
 */
export function truncarRelato(relato: RelatoTruncavel): RelatoTruncado {
  const message = cortarBytes(relato.message, MAX_MESSAGE_BYTES);
  let truncated = message !== relato.message;

  let stack = relato.stack;
  let userNote = relato.userNote;
  let sessionTail = relato.sessionTail;

  const tamanho = (): number =>
    bytes(message) +
    bytes(stack ?? '') +
    bytes(userNote ?? '') +
    bytes(sessionTail === null || sessionTail === undefined ? '' : json(sessionTail));

  // 1º sacrifício: `sessionTail` inteiro. Não é truncado pela metade porque
  // meio JSON não é JSON — o campo é `Json` no banco, e um objeto cortado ao
  // meio nem grava. Ou cabe, ou sai.
  if (tamanho() > MAX_PAYLOAD_BYTES && sessionTail !== null && sessionTail !== undefined) {
    sessionTail = null;
    truncated = true;
  }

  // 2º: a stack, esta sim cortável — as primeiras linhas são as que importam,
  // e um frame a menos no fundo não muda o diagnóstico.
  if (tamanho() > MAX_PAYLOAD_BYTES && stack) {
    const sobra = MAX_PAYLOAD_BYTES - bytes(message) - bytes(userNote ?? '');
    stack = sobra > 0 ? cortarBytes(stack, sobra) : null;
    truncated = true;
  }

  // 3º: a nota do usuário. Última porque é a única escrita por uma pessoa —
  // perder o que alguém digitou é pior que perder o que a máquina gerou.
  if (tamanho() > MAX_PAYLOAD_BYTES && userNote) {
    const sobra = MAX_PAYLOAD_BYTES - bytes(message);
    userNote = sobra > 0 ? cortarBytes(userNote, sobra) : null;
    truncated = true;
  }

  return { message, stack, userNote, sessionTail, truncated };
}

/** `JSON.stringify` que não explode em referência circular — o `sessionTail`
 *  vem de fora e nada garante que seja uma árvore. */
function json(valor: unknown): string {
  try {
    return JSON.stringify(valor) ?? '';
  } catch {
    return '';
  }
}
