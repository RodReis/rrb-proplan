import { parseKiwifyEvent } from './kiwify-event';

/**
 * O parse do payload da Kiwify (SPEC-038). **Fixtures decalcadas do exemplo
 * oficial** (`kiwify.notion.site/Webhooks-pt-br`, 2026-07-29) — campos e
 * aninhamento como a plataforma manda, não como seria conveniente.
 *
 * O CI nunca fala com a Kiwify nem depende de túnel (decisão #1 das perguntas
 * do MVP4).
 */

/** Compra aprovada de assinatura — o exemplo da documentação, aparado. */
const compraAprovada = {
  order_id: 'da292c35-c6fc-44e7-ad19-ff7865bc2d89',
  order_ref: 'Quzqwus',
  order_status: 'paid',
  payment_method: 'credit_card',
  webhook_event_type: 'order_approved',
  product_type: 'membership',
  approved_date: '2024-12-23 15:58',
  Product: {
    product_id: 'acfe6050-4387-11eb-85a0-43a3ebec8277',
    product_name: 'New Subscription',
  },
  Customer: {
    full_name: 'Mario Chase',
    first_name: 'Mario',
    email: 'Test@Example.com ',
    mobile: null,
  },
  Commissions: { charge_amount: '12424', currency: 'BRL' },
  Subscription: {
    start_date: '2020-12-21T13:46:20.508Z',
    next_payment: '2021-01-20T13:46:19.913Z',
    status: 'active',
    plan: { id: 'cc8dae72', name: '7 Day', frequency: 'monthly' },
  },
  subscription_id: '3a8d274e-1351-4678-b653-10be23d5d218',
};

describe('parseKiwifyEvent — compra aprovada', () => {
  it('extrai venda, comprador, produto e assinatura do payload PLANO', () => {
    const evento = parseKiwifyEvent(compraAprovada);

    expect(evento.action).toBe('issue');
    expect(evento.saleRef).toBe('da292c35-c6fc-44e7-ad19-ff7865bc2d89');
    expect(evento.externalProductId).toBe('acfe6050-4387-11eb-85a0-43a3ebec8277');
    expect(evento.subscriptionId).toBe('3a8d274e-1351-4678-b653-10be23d5d218');
    expect(evento.customerName).toBe('Mario Chase');
    expect(evento.periodEndsAt?.toISOString()).toBe('2021-01-20T13:46:19.913Z');
  });

  it('normaliza o e-mail — caixa e espaços', () => {
    // O e-mail é a identidade do comprador no suporte e o último resgate da
    // licença. `Test@Example.com ` e `test@example.com` são a mesma pessoa.
    expect(parseKiwifyEvent(compraAprovada).customerEmail).toBe('test@example.com');
  });

  it('a chave de idempotência da compra é o `order_id` sozinho', () => {
    // Uma venda emite uma licença. A Kiwify **não manda id de evento** e
    // reenvia até 5 vezes o que não recebe 2xx — é esta chave que torna a
    // reentrega inofensiva, via unique do banco.
    expect(parseKiwifyEvent(compraAprovada).externalEventId).toBe(
      'da292c35-c6fc-44e7-ad19-ff7865bc2d89',
    );
  });

  it('a oferta é sempre `null` — a Kiwify não manda oferta', () => {
    // Só `Product.product_id`. `null` é o que casa com a linha CURINGA do
    // mapeamento; `undefined` não casaria com nada.
    expect(parseKiwifyEvent(compraAprovada).externalOfferId).toBeNull();
  });

  it('cai no `order_ref` quando não há `order_id`', () => {
    const semId = { ...compraAprovada, order_id: undefined };
    expect(parseKiwifyEvent(semId).externalEventId).toBe('Quzqwus');
  });

  it('devolve chave vazia quando não há identificador nenhum', () => {
    // A rota recusa antes de gravar: sem chave não há idempotência possível, e
    // a segunda entrega viraria outra licença.
    expect(parseKiwifyEvent({ webhook_event_type: 'order_approved' }).externalEventId).toBe(
      '',
    );
  });
});

describe('parseKiwifyEvent — os tipos exatos da documentação', () => {
  const evento = (tipo: string, extra: Record<string, unknown> = {}) =>
    parseKiwifyEvent({
      webhook_event_type: tipo,
      order_id: 'ord_123',
      subscription_id: 'sub_1',
      ...extra,
    });

  it.each([
    ['order_refunded', 'revoke', 'reembolso'],
    ['chargeback', 'revoke', 'chargeback'],
  ])('%s → %s com motivo legível', (tipo, acao, motivo) => {
    // O motivo vai para `revokedReason` E para o e-mail do comprador.
    // "order_refunded" cru na caixa de entrada seria nosso jargão vazando.
    const e = evento(tipo);
    expect(e.action).toBe(acao);
    expect(e.revokeReason).toBe(motivo);
  });

  it.each([
    ['subscription_renewed', 'renew'],
    ['subscription_late', 'past_due'],
    ['subscription_canceled', 'cancel'],
  ])('%s → %s', (tipo, acao) => {
    expect(evento(tipo).action).toBe(acao);
  });

  it('o tipo vence o `order_status`', () => {
    // Os dois vêm juntos na maioria dos eventos. Numa assinatura atrasada, o
    // `order_status` pode continuar `paid` (da última cobrança que deu certo) —
    // e ler o status ali marcaria emissão em vez de atraso.
    const e = evento('subscription_late', { order_status: 'paid' });
    expect(e.action).toBe('past_due');
  });
});

describe('parseKiwifyEvent — a chave de idempotência da assinatura', () => {
  const assinatura = (tipo: string, orderId: string) =>
    parseKiwifyEvent({
      webhook_event_type: tipo,
      order_id: orderId,
      subscription_id: 'sub_1',
    }).externalEventId;

  it('renovações de meses diferentes têm chaves diferentes', () => {
    // O bug que este teste impede é caro e silencioso: com a chave sendo só o
    // `subscription_id`, a renovação de agosto seria descartada como duplicata
    // da de julho, `expiresAt` congelaria, e o acesso morreria com a assinatura
    // EM DIA.
    expect(assinatura('subscription_renewed', 'ord_jul')).not.toBe(
      assinatura('subscription_renewed', 'ord_ago'),
    );
  });

  it('tipos diferentes da MESMA assinatura têm chaves diferentes', () => {
    // Sem o tipo na chave, o cancelamento de hoje seria duplicata da renovação
    // de três meses atrás — e o cliente manteria acesso depois de cancelar.
    expect(assinatura('subscription_canceled', 'ord_1')).not.toBe(
      assinatura('subscription_renewed', 'ord_1'),
    );
  });

  it('a MESMA entrega repetida tem a mesma chave', () => {
    // O outro lado: reentrega (até 5 vezes, por documentação) precisa colidir.
    expect(assinatura('subscription_renewed', 'ord_1')).toBe(
      assinatura('subscription_renewed', 'ord_1'),
    );
  });
});

describe('parseKiwifyEvent — o que NÃO nos diz respeito', () => {
  it.each([
    ['billet_created', 'boleto gerado é intenção, não compra'],
    ['pix_created', 'pix gerado é intenção, não compra'],
    ['order_rejected', 'cartão recusado no ato é venda que não aconteceu'],
  ])('%s → ignore (%s)', (tipo) => {
    // `order_rejected` em especial: marcar `pastDueAt` aí criaria atraso numa
    // licença que nunca existiu.
    const e = parseKiwifyEvent({ webhook_event_type: tipo, order_id: 'x' });
    expect(e.action).toBe('ignore');
    // O tipo cru é preservado: o admin precisa ler o que a plataforma disse.
    expect(e.eventType).toBe(tipo);
  });

  it('tipo novo e desconhecido vira `ignore`, não erro', () => {
    // A plataforma acrescenta tipos sem avisar. Tratar o desconhecido como
    // falha encheria a lista de pendências do admin de coisas sem conserto.
    expect(
      parseKiwifyEvent({ webhook_event_type: 'algo_novo_de_2027', order_id: 'x' }).action,
    ).toBe('ignore');
  });

  it('carrinho abandonado não traz `webhook_event_type` e cai no status', () => {
    // A documentação diz que é o único evento sem o parâmetro. Sem status
    // conhecido, `ignore`.
    const e = parseKiwifyEvent({ order_id: 'x', order_status: 'abandoned' });
    expect(e.action).toBe('ignore');
  });

  it('sem `webhook_event_type`, `order_status: paid` emite', () => {
    // O webhook de TESTE do painel e integrações antigas mandam só o status — e
    // `paid` é o que a própria Kiwify diz para conferir antes de liberar acesso.
    const e = parseKiwifyEvent({
      order_id: 'x',
      order_status: 'paid',
      Customer: { email: 'a@b.com' },
      Product: { product_id: 'p1' },
    });
    expect(e.action).toBe('issue');
  });

  it.each([null, undefined, 'texto', 42, []])('payload %p não lança', (payload) => {
    // Um `throw` aqui derrubaria a rota — e a Kiwify reenviaria até 5 vezes.
    expect(() => parseKiwifyEvent(payload)).not.toThrow();
    expect(parseKiwifyEvent(payload).action).toBe('ignore');
  });

  it('aceita o payload aninhado em `order` (Zapier, n8n, webhook de teste)', () => {
    // O payload da Kiwify é plano, mas integrações intermediárias envelopam.
    const e = parseKiwifyEvent({
      order: {
        order_id: 'ord_9',
        webhook_event_type: 'order_approved',
        Customer: { email: 'x@y.com' },
        Product: { product_id: 'p1' },
      },
    });
    expect(e.action).toBe('issue');
    expect(e.saleRef).toBe('ord_9');
  });

  it('data inválida vira `null`, não `Invalid Date`', () => {
    // Um `Invalid Date` em `expiresAt` faria TODA comparação de expiração
    // devolver `false`, e a licença nunca venceria — falha no lado errado.
    const e = parseKiwifyEvent({
      webhook_event_type: 'subscription_renewed',
      order_id: 'x',
      Subscription: { next_payment: 'ontem' },
    });
    expect(e.periodEndsAt).toBeNull();
  });
});
