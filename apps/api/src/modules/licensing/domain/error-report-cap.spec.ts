import {
  MAX_MESSAGE_BYTES,
  MAX_PAYLOAD_BYTES,
  bytes,
  cortarBytes,
  truncarRelato,
} from './error-report-cap';

/** String de N bytes ASCII. */
const encher = (n: number): string => 'x'.repeat(n);

describe('cortarBytes', () => {
  it('devolve a string intacta quando cabe no limite', () => {
    expect(cortarBytes('abc', 10)).toBe('abc');
  });

  it('corta no limite de bytes', () => {
    expect(cortarBytes(encher(100), 10)).toHaveLength(10);
  });

  it('não parte caractere multibyte ao meio', () => {
    // 'é' são 2 bytes em UTF-8. Cortar em 3 bytes deve dar 1 caractere, não
    // 1 caractere + meio — que apareceria como losango preto na tela do admin.
    const texto = 'ééé';
    const cortado = cortarBytes(texto, 3);
    expect(cortado).toBe('é');
    expect(bytes(cortado)).toBeLessThanOrEqual(3);
    expect(cortado).not.toContain('�');
  });

  it('conta bytes, não caracteres — acento ocupa o dobro', () => {
    expect(bytes('aaa')).toBe(3);
    expect(bytes('ééé')).toBe(6);
  });
});

describe('truncarRelato', () => {
  const base = {
    message: 'Erro ao abrir projeto',
    stack: 'at foo()\nat bar()',
    userNote: 'aconteceu ao salvar',
    sessionTail: { arquivos: ['a.ts'] },
  };

  it('não toca no relato que cabe', () => {
    const r = truncarRelato(base);
    expect(r).toEqual({ ...base, truncated: false });
  });

  it('não muta a entrada', () => {
    const entrada = { ...base, sessionTail: { linhas: [encher(MAX_PAYLOAD_BYTES)] } };
    const copia = JSON.parse(JSON.stringify(entrada));
    truncarRelato(entrada);
    expect(JSON.parse(JSON.stringify(entrada))).toEqual(copia);
  });

  it('sacrifica sessionTail primeiro, preservando stack e userNote', () => {
    const r = truncarRelato({
      ...base,
      sessionTail: { linhas: [encher(MAX_PAYLOAD_BYTES)] },
    });

    expect(r.sessionTail).toBeNull();
    expect(r.stack).toBe(base.stack);
    expect(r.userNote).toBe(base.userNote);
    expect(r.message).toBe(base.message);
    expect(r.truncated).toBe(true);
  });

  it('corta a stack quando sessionTail sozinho não basta', () => {
    const r = truncarRelato({
      ...base,
      stack: encher(MAX_PAYLOAD_BYTES * 2),
      sessionTail: { linhas: [encher(1000)] },
    });

    expect(r.sessionTail).toBeNull();
    expect(bytes(r.stack ?? '')).toBeLessThanOrEqual(MAX_PAYLOAD_BYTES);
    expect(r.message).toBe(base.message);
    expect(r.truncated).toBe(true);
  });

  it('a mensagem NUNCA é sacrificada — sem ela o relato não é agrupável', () => {
    const r = truncarRelato({
      message: 'Erro específico',
      stack: encher(MAX_PAYLOAD_BYTES * 3),
      userNote: encher(MAX_PAYLOAD_BYTES * 3),
      sessionTail: { linhas: [encher(MAX_PAYLOAD_BYTES)] },
    });

    expect(r.message).toBe('Erro específico');
  });

  it('corta a mensagem no teto próprio, sem depender do cap global', () => {
    // Sem o teto de `message`, uma mensagem gigante sozinha deixaria o cap
    // global sem nada para sacrificar — e a linha entraria acima do limite.
    const r = truncarRelato({
      message: encher(MAX_MESSAGE_BYTES * 4),
      stack: null,
      userNote: null,
      sessionTail: null,
    });

    expect(bytes(r.message)).toBe(MAX_MESSAGE_BYTES);
    expect(r.truncated).toBe(true);
  });

  it('o resultado cabe no cap mesmo com todos os campos gigantes', () => {
    const r = truncarRelato({
      message: encher(MAX_MESSAGE_BYTES * 2),
      stack: encher(MAX_PAYLOAD_BYTES * 2),
      userNote: encher(MAX_PAYLOAD_BYTES * 2),
      sessionTail: { linhas: [encher(MAX_PAYLOAD_BYTES * 2)] },
    });

    const total =
      bytes(r.message) +
      bytes(r.stack ?? '') +
      bytes(r.userNote ?? '') +
      bytes(r.sessionTail === null ? '' : JSON.stringify(r.sessionTail));

    expect(total).toBeLessThanOrEqual(MAX_PAYLOAD_BYTES);
  });

  it('sessionTail circular não derruba o cálculo', () => {
    // `sessionTail` vem de fora; nada garante que seja uma árvore. Um throw aqui
    // viraria `500` numa rota pública cuja promessa é nunca recusar o relato.
    const circular: Record<string, unknown> = { a: 1 };
    circular.self = circular;

    expect(() =>
      truncarRelato({ ...base, sessionTail: circular }),
    ).not.toThrow();
  });
});
