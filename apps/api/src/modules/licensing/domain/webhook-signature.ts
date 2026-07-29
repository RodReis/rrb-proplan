import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Verificação da assinatura do webhook (SPEC-038 §Contratos).
 *
 * ## O contrato real da Kiwify
 *
 * Confirmado na documentação oficial (`kiwify.notion.site/Webhooks-pt-br`,
 * consultada em 2026-07-29) e no painel:
 *
 * - A assinatura vem em **`?signature=` na query string**, não em header.
 * - O algoritmo é **HMAC-SHA1**, e só ele: `hmac_sha1(JSON.stringify(body), token)`.
 * - O segredo é o **Token do webhook**, gerado pela Kiwify na criação (algo como
 *   `7ih5upe3rvb`) — é ele que vai para `LicSettings.webhookSecret`. Não é um
 *   segredo que nós escolhemos.
 *
 * ## A parte contraintuitiva, e por que verificamos DUAS formas
 *
 * Os dois exemplos oficiais (JS e PHP) fazem a mesma coisa: parseiam o corpo e
 * assinam o **re-serializado** — `JSON.stringify(JSON.parse(body))`, não os
 * bytes recebidos. Ou seja, a Kiwify assina uma forma *normalizada* do JSON, e
 * verificar só o `rawBody` recusaria toda entrega legítima sempre que o
 * serializador deles diferisse do nosso em um espaço.
 *
 * Isso é frágil do lado deles — depende de dois serializadores concordarem em
 * ordem de chaves e escapes — mas é o contrato publicado. Então testamos as
 * duas formas: o `rawBody` (o correto para qualquer plataforma que assine
 * bytes, incluindo a Hotmart que a fatia prevê como próxima) e o re-stringify
 * (o que a Kiwify realmente faz). Duas comparações de HMAC numa rota que recebe
 * poucas entregas por dia; o custo é irrelevante e o modo de falha que elas
 * evitam é "nenhuma venda vira licença, e o log diz apenas 401".
 *
 * ## Comparação em tempo constante
 *
 * `timingSafeEqual`, nunca `===` — nem o `!==` do exemplo oficial. A diferença
 * de microssegundos entre "errou no 1º byte" e "errou no 20º" é mensurável pela
 * rede e permite descobrir a assinatura byte a byte. Mesma decisão do
 * `briefing-token.ts`.
 */

/** O que a rota tem em mãos quando chama. */
export interface SignatureInput {
  /** Bytes exatos do corpo, como chegaram. */
  rawBody: Buffer;
  /**
   * O corpo já parseado. É sobre o re-stringify DESTE objeto que a Kiwify
   * calcula a assinatura (ver bloco acima).
   */
  payload: unknown;
  /** Token do webhook daquele tenant (`LicSettings.webhookSecret`). */
  secret: string;
  /** `?signature=` da URL — onde a Kiwify a coloca. */
  querySignature?: string;
  /**
   * Headers, em minúsculas. A Kiwify não usa header para o webhook de venda;
   * ficam aceitos porque a fatia prevê outras plataformas atrás do mesmo
   * `platform`, e porque um túnel de dev pode reencaminhar por header.
   */
  headers: Record<string, string | undefined>;
}

/**
 * `true` só quando a assinatura confere com o token **daquele** tenant.
 *
 * Ausência de assinatura é `false`, nunca `true`: uma rota pública que aceita
 * entrega não assinada é uma rota que qualquer um usa para emitir licença.
 */
export function verifySignature(input: SignatureInput): boolean {
  const { secret } = input;

  // Segredo vazio recusaria tudo silenciosamente se comparado normalmente — e
  // um CHECK no banco já impede a linha, mas a defesa mora nos dois lugares:
  // aqui, se ela falhasse, a verificação viraria decorativa.
  if (!secret) return false;

  const assinatura = (
    input.querySignature ??
    input.headers['x-kiwify-signature'] ??
    input.headers['x-webhook-signature'] ??
    ''
  ).trim();

  if (!assinatura) return false;

  for (const corpo of corposCandidatos(input)) {
    // SHA-1 é o que a Kiwify documenta. Ele é fraco para hashing de senha, mas
    // HMAC-SHA1 continua adequado para autenticar mensagem — e, de todo modo, a
    // escolha não é nossa: assinatura é contrato de duas pontas.
    const esperada = createHmac('sha1', secret).update(corpo).digest('hex');
    if (iguais(assinatura, esperada)) return true;
  }

  return false;
}

/**
 * As duas formas do corpo que podem ter sido assinadas.
 *
 * O re-stringify vem primeiro porque é o que a Kiwify faz — o caminho comum
 * acerta na primeira tentativa.
 */
function corposCandidatos(input: SignatureInput): Buffer[] {
  const candidatos: Buffer[] = [];

  try {
    candidatos.push(Buffer.from(JSON.stringify(input.payload), 'utf8'));
  } catch {
    // Payload com referência circular não vem de JSON de rede; ignorar aqui é
    // preferível a derrubar a verificação inteira num caso impossível.
  }

  // O `rawBody` como fallback: é o correto para qualquer plataforma que assine
  // bytes, e é o que faz a próxima plataforma (Hotmart) entrar sem tocar nisto.
  if (input.rawBody?.length) candidatos.push(input.rawBody);

  return candidatos;
}

/**
 * Comparação em tempo constante, tolerante a caixa.
 *
 * O `length` é checado antes porque `timingSafeEqual` **lança** com buffers de
 * tamanhos diferentes — e um throw aqui viraria `500` numa rota que deve
 * responder `401`. O vazamento de tempo do `length` é irrelevante: o tamanho de
 * um hex de HMAC-SHA1 é público (40 caracteres).
 */
function iguais(recebida: string, esperada: string): boolean {
  const a = Buffer.from(recebida.toLowerCase(), 'utf8');
  const b = Buffer.from(esperada.toLowerCase(), 'utf8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
