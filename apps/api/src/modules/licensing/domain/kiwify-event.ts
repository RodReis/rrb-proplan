/**
 * O payload da Kiwify → um evento que o processador entende (SPEC-038 §Escopo).
 *
 * **Escrito contra a documentação oficial** (`kiwify.notion.site/Webhooks-pt-br`,
 * consultada em 2026-07-29), não contra suposição. Três fatos dela mudaram o
 * desenho:
 *
 * 1. **Não existe `webhook_event_id`.** O payload traz `order_id` (uuid da
 *    venda) e `order_ref`; o id do evento não existe. Então a idempotência do
 *    recebimento se ancora no `order_id` — e, para eventos de assinatura, no par
 *    `subscription_id` + tipo, porque a mesma assinatura gera renovação, atraso
 *    e cancelamento ao longo do tempo e os três chegam com `order_id` diferente
 *    ou repetido conforme a cobrança.
 * 2. **Não existe `offer_id`.** Só `Product.product_id`. O mapeamento
 *    oferta→edição da spec continua existindo no schema (a coluna é nullable e
 *    outras plataformas a usam), mas para a Kiwify o casamento é sempre pelo
 *    **produto**, na linha curinga.
 * 3. **`webhook_event_type` não vem no evento de carrinho abandonado.** Sem ele,
 *    o `order_status` responde — e é por isso que o parse lê os dois.
 *
 * **Função pura, e é o que torna a fatia testável sem túnel nem plataforma.** As
 * fixtures gravadas entram aqui; o CI nunca fala com a Kiwify (decisão #1 das
 * perguntas do MVP4).
 */

/** O que o processador faz com o evento. */
export type EventAction =
  | 'issue' // compra aprovada → emite licença + e-mail
  | 'revoke' // reembolso/chargeback → revoga + e-mail
  | 'renew' // renovação → estende `expiresAt` e limpa `pastDueAt`
  | 'past_due' // atraso → marca `pastDueAt`, mantém acesso
  | 'cancel' // cancelamento → acesso até o fim do ciclo pago
  | 'ignore'; // tipo que não nos diz respeito

export interface ParsedEvent {
  /**
   * Chave de idempotência do recebimento. Derivada, não lida — a Kiwify não
   * manda id de evento (ver bloco acima).
   */
  externalEventId: string;
  /** Tipo cru, como veio. Gravado para o admin ler o que a plataforma disse. */
  eventType: string;
  action: EventAction;
  /** Motivo da revogação, em linguagem de quem lê o admin. */
  revokeReason?: string;
  /** `order_id` — vira `License.saleRef`. */
  saleRef?: string;
  /** `subscription_id`, quando a venda é recorrente. */
  subscriptionId?: string;
  customerEmail?: string;
  customerName?: string | null;
  /** `Product.product_id` — resolve a edição pelo mapeamento. */
  externalProductId?: string;
  /**
   * Sempre `null` para a Kiwify: o payload não tem oferta. O campo existe
   * porque o mapeamento é multiplataforma, e `null` é o que casa com a linha
   * curinga do produto.
   */
  externalOfferId?: string | null;
  /** `Subscription.next_payment` — o fim do ciclo pago. */
  periodEndsAt?: Date | null;
}

/**
 * Os valores exatos de `webhook_event_type`, da documentação.
 *
 * **`billet_created`, `pix_created`, `order_rejected` e o carrinho abandonado
 * não estão aqui de propósito.** Boleto e Pix gerados são intenção de compra,
 * não compra; `order_rejected` é cartão recusado **no ato**, que é uma venda que
 * não aconteceu — e não inadimplência de assinatura. Marcar `pastDueAt` num
 * `order_rejected` criaria atraso numa licença que nunca existiu.
 */
const ACOES: Record<string, EventAction> = {
  order_approved: 'issue',
  order_refunded: 'revoke',
  chargeback: 'revoke',
  subscription_renewed: 'renew',
  subscription_late: 'past_due',
  subscription_canceled: 'cancel',
};

/**
 * Fallback pelo `order_status` quando `webhook_event_type` não vem.
 *
 * A documentação lista o carrinho abandonado como o único evento sem o
 * parâmetro — mas o webhook de teste do painel e integrações antigas mandam só
 * o status, e `paid` é o que a própria Kiwify diz para conferir antes de liberar
 * acesso.
 */
const ACOES_POR_STATUS: Record<string, EventAction> = {
  paid: 'issue',
  refunded: 'revoke',
  chargedback: 'revoke',
};

/** Motivo legível por tipo — vai para `revokedReason` e para o e-mail. */
const MOTIVOS: Record<string, string> = {
  order_refunded: 'reembolso',
  chargeback: 'chargeback',
  refunded: 'reembolso',
  chargedback: 'chargeback',
};

/**
 * Lê o payload e devolve o evento. **Nunca lança**: payload malformado vira
 * `ignore`, porque um `throw` aqui derrubaria a rota que precisa responder
 * `200` — a Kiwify reenvia até 5 vezes o que não recebe `2xx`.
 */
export function parseKiwifyEvent(payload: unknown): ParsedEvent {
  const p = (payload ?? {}) as Record<string, unknown>;

  // O payload da Kiwify é PLANO: `order_id` e `Customer` no nível raiz. O
  // envelope `order` é lido também porque o webhook de teste do painel e
  // integrações intermediárias (Zapier, n8n) aninham.
  const order = objeto(p.order) ?? objeto(p.Order) ?? p;
  const customer = objeto(order.Customer) ?? objeto(order.customer) ?? {};
  const produto = objeto(order.Product) ?? objeto(order.product) ?? {};
  const assinatura = objeto(order.Subscription) ?? objeto(order.subscription) ?? {};

  const tipo = texto(order.webhook_event_type ?? p.webhook_event_type).toLowerCase();
  const status = texto(order.order_status ?? p.order_status).toLowerCase();

  // O tipo vence o status: os dois vêm juntos na maioria dos eventos, e é o
  // tipo que distingue `subscription_late` de um `order_status` que continua
  // dizendo `paid` da última cobrança bem-sucedida.
  const action = ACOES[tipo] ?? (tipo ? 'ignore' : (ACOES_POR_STATUS[status] ?? 'ignore'));

  const saleRef = texto(order.order_id ?? order.id) || undefined;
  const subscriptionId = texto(order.subscription_id ?? assinatura.id) || undefined;

  return {
    externalEventId: chaveDeIdempotencia({
      tipo: tipo || status,
      action,
      saleRef,
      subscriptionId,
      orderRef: texto(order.order_ref),
    }),
    eventType: tipo || status || 'desconhecido',
    action,
    revokeReason: MOTIVOS[tipo] ?? MOTIVOS[status],
    saleRef,
    subscriptionId,
    customerEmail: texto(customer.email).toLowerCase() || undefined,
    customerName: texto(customer.full_name ?? customer.first_name) || null,
    externalProductId: texto(produto.product_id ?? produto.id) || undefined,
    // A Kiwify não manda oferta. `null` casa com a linha curinga do produto.
    externalOfferId: null,
    periodEndsAt: data(assinatura.next_payment),
  };
}

/**
 * A chave de idempotência do recebimento, derivada do payload.
 *
 * **A Kiwify não manda id de evento**, e o `@@unique(platform,
 * externalEventId)` do banco é o que torna a reentrega (até 5 vezes, por
 * documentação) inofensiva. Então a chave é construída, e a composição é a
 * decisão:
 *
 * - **Compra**: `order_id` sozinho. Uma venda emite uma licença, e reentrega da
 *   mesma venda não pode emitir a segunda.
 * - **Evento de assinatura**: `subscription_id` + tipo. A mesma assinatura gera
 *   renovação, atraso e cancelamento ao longo dos meses; usar só o
 *   `subscription_id` faria o **cancelamento** ser descartado como duplicata da
 *   **renovação** de três meses antes — e o cliente manteria acesso.
 * - **Renovação**: entra o `order_id` da cobrança, que é novo a cada mês.
 *   Sem ele, a renovação de agosto seria ignorada como duplicata da de julho, e
 *   `expiresAt` congelaria — o acesso morreria com a assinatura em dia.
 */
function chaveDeIdempotencia(dados: {
  tipo: string;
  action: EventAction;
  saleRef?: string;
  subscriptionId?: string;
  orderRef: string;
}): string {
  const { tipo, action, saleRef, subscriptionId, orderRef } = dados;

  if (action === 'issue') return saleRef ?? orderRef ?? '';

  if (subscriptionId) {
    // `saleRef` entra quando existe: é ele que distingue a cobrança de agosto da
    // de julho no mesmo `subscription_id`.
    return [subscriptionId, tipo, saleRef].filter(Boolean).join(':');
  }

  const base = saleRef ?? orderRef;
  return base ? `${base}:${tipo}` : '';
}

function objeto(valor: unknown): Record<string, unknown> | undefined {
  return typeof valor === 'object' && valor !== null && !Array.isArray(valor)
    ? (valor as Record<string, unknown>)
    : undefined;
}

function texto(valor: unknown): string {
  if (typeof valor === 'string') return valor.trim();
  if (typeof valor === 'number') return String(valor);
  return '';
}

/**
 * Data da plataforma → `Date`, ou `null`.
 *
 * Data inválida vira `null` em vez de `Invalid Date`: um `Invalid Date` gravado
 * em `expiresAt` faria toda comparação de expiração devolver `false`, e a
 * licença nunca venceria — falha silenciosa no lado errado.
 */
function data(valor: unknown): Date | null {
  const bruto = texto(valor);
  if (!bruto) return null;
  const d = new Date(bruto);
  return Number.isNaN(d.getTime()) ? null : d;
}
