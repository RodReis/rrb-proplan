import { createHmac } from 'node:crypto';
import { verifySignature } from './webhook-signature';

/**
 * Verificação da assinatura (SPEC-038), escrita contra a documentação oficial
 * da Kiwify: `signature` na query string, HMAC-SHA1, e o segredo é o **Token do
 * webhook** que a plataforma gera.
 *
 * É a única coisa entre uma rota pública e a emissão de licença — então os
 * testes que mais importam são os que provam o que ela **recusa**.
 */
describe('verifySignature', () => {
  // Formato do token real do painel da Kiwify: curto, alfanumérico.
  const secret = '7ih5upe3rvb';
  const payload = { order_id: 'da292c35', order_status: 'paid' };
  const rawBody = Buffer.from(JSON.stringify(payload));

  /** Como a Kiwify assina: HMAC-SHA1 do re-stringify do objeto parseado. */
  const comoAKiwify = (corpo: unknown = payload, chave = secret) =>
    createHmac('sha1', chave).update(JSON.stringify(corpo)).digest('hex');

  it('aceita a assinatura da Kiwify: SHA1 do JSON re-serializado, na query', () => {
    expect(
      verifySignature({
        rawBody,
        payload,
        secret,
        querySignature: comoAKiwify(),
        headers: {},
      }),
    ).toBe(true);
  });

  it('aceita quando o corpo CRU difere do re-stringify', () => {
    // O caso que justifica verificar as duas formas. Aqui os bytes recebidos
    // têm espaços que o nosso `JSON.stringify` não produz; a Kiwify assinou o
    // normalizado. Verificar só o `rawBody` recusaria esta entrega legítima —
    // e o sintoma seria "nenhuma venda vira licença", com 401 no log.
    const cruComEspacos = Buffer.from(JSON.stringify(payload, null, 2));
    expect(
      verifySignature({
        rawBody: cruComEspacos,
        payload,
        secret,
        querySignature: comoAKiwify(),
        headers: {},
      }),
    ).toBe(true);
  });

  it('aceita assinatura sobre os BYTES crus — a próxima plataforma', () => {
    // A Hotmart (prevista em §Fora de escopo) assina bytes, como manda o bom
    // senso. Este caminho é o que a deixa entrar sem tocar nesta função.
    const cru = Buffer.from('{"z":1,"a":2}');
    const assinaturaDosBytes = createHmac('sha1', secret).update(cru).digest('hex');
    expect(
      verifySignature({
        rawBody: cru,
        // O payload parseado re-serializa em outra ordem de chaves, de propósito:
        // é o que prova que foi o `rawBody` que casou.
        payload: { a: 2, z: 1 },
        secret,
        querySignature: assinaturaDosBytes,
        headers: {},
      }),
    ).toBe(true);
  });

  it('aceita a assinatura pelo header', () => {
    // A Kiwify não usa header no webhook de venda; o caminho existe porque um
    // túnel de dev pode reencaminhar assim, e outras plataformas usam.
    expect(
      verifySignature({
        rawBody,
        payload,
        secret,
        headers: { 'x-kiwify-signature': comoAKiwify() },
      }),
    ).toBe(true);
  });

  it('ignora diferença de caixa no hex', () => {
    expect(
      verifySignature({
        rawBody,
        payload,
        secret,
        querySignature: comoAKiwify().toUpperCase(),
        headers: {},
      }),
    ).toBe(true);
  });

  it('recusa assinatura ausente', () => {
    // Uma rota pública que aceita entrega não assinada é uma rota que qualquer
    // um usa para emitir licença.
    expect(verifySignature({ rawBody, payload, secret, headers: {} })).toBe(false);
  });

  it('recusa assinatura vazia', () => {
    expect(
      verifySignature({ rawBody, payload, secret, querySignature: '   ', headers: {} }),
    ).toBe(false);
  });

  it('recusa segredo vazio', () => {
    // O CHECK do banco já impede a linha, mas a defesa mora nos dois lugares:
    // se ele falhasse, a verificação viraria decorativa.
    expect(
      verifySignature({
        rawBody,
        payload,
        secret: '',
        querySignature: comoAKiwify(),
        headers: {},
      }),
    ).toBe(false);
  });

  it('recusa assinatura feita com o token de OUTRO tenant', () => {
    // O critério de aceite da decisão PI #1: evento assinado com o segredo do
    // tenant A, enviado para a URL do tenant B, não passa.
    expect(
      verifySignature({
        rawBody,
        payload,
        secret,
        querySignature: comoAKiwify(payload, 'token-de-outro-tenant'),
        headers: {},
      }),
    ).toBe(false);
  });

  it('recusa quando o payload foi adulterado', () => {
    // O ponto de assinar: um valor mexido no meio do caminho (status da venda,
    // e-mail do comprador) deixa de conferir.
    const assinaturaOriginal = comoAKiwify();
    const adulterado = { order_id: 'da292c35', order_status: 'refunded' };
    expect(
      verifySignature({
        rawBody: Buffer.from(JSON.stringify(adulterado)),
        payload: adulterado,
        secret,
        querySignature: assinaturaOriginal,
        headers: {},
      }),
    ).toBe(false);
  });

  it('recusa SHA256 — a Kiwify usa SHA1, e aceitar mais é aceitar forjado', () => {
    // Aceitar qualquer algoritmo "por segurança" amplia a superfície: bastaria
    // um algoritmo mais fraco na lista para a verificação valer o mais fraco.
    const sha256 = createHmac('sha256', secret).update(JSON.stringify(payload)).digest('hex');
    expect(
      verifySignature({ rawBody, payload, secret, querySignature: sha256, headers: {} }),
    ).toBe(false);
  });

  it('recusa assinatura de tamanho diferente sem lançar', () => {
    // `timingSafeEqual` LANÇA com buffers de tamanhos diferentes, e um throw
    // aqui viraria `500` numa rota que deve responder `401`.
    const chamada = () =>
      verifySignature({ rawBody, payload, secret, querySignature: 'abc', headers: {} });
    expect(chamada).not.toThrow();
    expect(chamada()).toBe(false);
  });

  it('a query vence o header quando os dois vêm', () => {
    // Uma ordem definida importa: sem ela, um header forjado poderia mascarar a
    // assinatura legítima da query — ou o contrário, dependendo do dia.
    expect(
      verifySignature({
        rawBody,
        payload,
        secret,
        querySignature: comoAKiwify(),
        headers: { 'x-kiwify-signature': 'lixo' },
      }),
    ).toBe(true);
  });

  it('não lança com payload circular', () => {
    // `JSON.stringify` lança em referência circular. Não vem de JSON de rede,
    // mas derrubar a verificação inteira num caso impossível seria pior.
    const circular: Record<string, unknown> = { a: 1 };
    circular.self = circular;
    expect(() =>
      verifySignature({
        rawBody,
        payload: circular,
        secret,
        querySignature: 'x'.repeat(40),
        headers: {},
      }),
    ).not.toThrow();
  });
});
