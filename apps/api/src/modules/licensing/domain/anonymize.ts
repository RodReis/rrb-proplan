/**
 * A redação de dado pessoal na exclusão a pedido (SPEC-040 §Exclusão a pedido).
 *
 * ## Anonimizar não é deletar, e a diferença é a ação inteira
 *
 * O direito do titular é sobre **dado pessoal**, não sobre o fato da transação.
 * Apagar a linha atenderia ao pedido e destruiria a prova de emissão, ativação
 * e revogação — inclusive a prova de que a exclusão foi feita. Implementar
 * "delete da linha" seria cumprir a letra e destruir o registro.
 *
 * Por isso o que existe aqui é **substituição por marcador**, e não remoção: a
 * licença continua, as ativações continuam, a trilha continua, o `saleRef`
 * continua. O que sai é quem é a pessoa.
 *
 * ## Por que marcador, e não string vazia
 *
 * `''` num `customerEmail` seria indistinguível de um bug de gravação. O
 * marcador afirma que **houve um ato deliberado** — e é o que faz uma tela
 * mostrar *"dados excluídos a pedido"* em vez de um campo em branco que o
 * operador leria como erro do sistema.
 */

/** O que fica no lugar do dado pessoal. Reconhecível a olho, e estável. */
export const ANONIMO_EMAIL = 'anonimizado@removido.local';
export const ANONIMO_NOME = '[dados excluídos a pedido]';

/**
 * Os campos do payload bruto que **sobrevivem** à anonimização.
 *
 * ## Allowlist, e não denylist — a decisão que mais importa aqui
 *
 * Uma denylist apagaria os campos pessoais **que conhecemos hoje** (`email`,
 * `full_name`, `mobile`…). O payload é da plataforma, não nosso: no dia em que
 * a Kiwify acrescentar `customer_document` — ou no dia em que o adapter da
 * Hotmart entrar (a coluna `platform` existe para isso) — o campo novo
 * **sobreviveria à anonimização em silêncio**. O titular teria pedido a
 * exclusão, o ProPlan teria respondido que fez, e o CPF continuaria no banco.
 *
 * A allowlist erra para o outro lado: campo novo é descartado até alguém
 * decidir que ele é de conciliação. Perder contexto de depuração é reversível
 * pela plataforma, que tem o evento original. Vazar dado pessoal não é.
 *
 * **São os três que a spec nomeia como preservados**: o id do evento na
 * plataforma, o tipo e a data — o que permite conferir a venda lá fora sem
 * dizer quem comprou.
 */
export const CAMPOS_DE_CONCILIACAO = [
  'order_id',
  'order_ref',
  'subscription_id',
  'webhook_event_type',
  'order_status',
  'created_at',
  'updated_at',
] as const;

/**
 * O payload, reduzido aos campos de conciliação.
 *
 * **O preço não está na lista, e é deliberado.** Ele é o único dado do payload
 * que a SPEC-040 §Métricas manda não usar para número nenhum — o link para a
 * plataforma é o caminho, e é lá que ele continua existindo. Preservá-lo aqui
 * seria guardar, num registro que o titular pediu para limpar, o dado cuja
 * autoridade a fatia inteira declara ser de outro sistema.
 *
 * Payload que não é objeto (array, string, `null` — a coluna é `Json` e a
 * plataforma é quem escreve) vira objeto vazio: não há campo nomeado a
 * preservar, e devolver o valor original deixaria passar o que quer que ele
 * fosse.
 */
export function redigirPayload(payload: unknown): Record<string, unknown> {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    return {};
  }

  const origem = payload as Record<string, unknown>;
  const limpo: Record<string, unknown> = {};
  for (const campo of CAMPOS_DE_CONCILIACAO) {
    // `in` e não truthy: `order_status: ''` é um fato que a plataforma mandou,
    // e descartá-lo por ser falsy inventaria uma ausência.
    if (campo in origem) limpo[campo] = origem[campo];
  }
  return limpo;
}

/**
 * O e-mail do destinatário numa entrega, redigido.
 *
 * **A entrega em si não some.** "Um e-mail com a chave saiu no dia X e foi
 * entregue" é fato da transação; para quem ele foi é dado pessoal. Apagar a
 * linha destruiria a resposta a *"vocês chegaram a mandar a chave?"* — que é
 * exatamente a pergunta que sobra depois de o cliente sumir do sistema.
 */
export const ANONIMO_DESTINATARIO = ANONIMO_EMAIL;
