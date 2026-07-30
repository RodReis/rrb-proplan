/** Fila do processamento de webhook de venda (SPEC-038, ADR-004). */
export const LICENSING_QUEUE = 'licensing';

/**
 * Identificador da plataforma de venda, como gravado em `LicWebhookEvent.platform`
 * e `LicOfferMapping.platform`.
 *
 * Constante porque **o cadastro e a leitura precisam casar exatamente**: o
 * processador (PR-3) busca o mapeamento filtrando por esta string, e um cadastro
 * que gravasse `'Kiwify'` produziria o pior sintoma possível — mapeamento
 * visível na tela, compra continuando a falhar como "oferta não mapeada", e
 * nada errado em log nenhum.
 *
 * Só a Kiwify é implementada (a spec põe outras plataformas fora de escopo); o
 * adapter é a fronteira quando houver a segunda.
 */
export const PLATFORM_KIWIFY = 'kiwify';

/**
 * `LicEvent.type` do corte por tolerância de inadimplência (SPEC-038, PR-4).
 *
 * **Sem o prefixo `webhook_`** que o PR-3 usa nos eventos vindos da plataforma:
 * este corte é decisão nossa (a tolerância venceu), e a spec pede que ele seja
 * distinguível da revogação que a plataforma manda. Constante, e não literal
 * solto, porque o gate grava e a leitura de idempotência consulta — divergir as
 * duas grafias faria o corte ser registrado a cada heartbeat.
 */
export const PAST_DUE_CUT = 'past_due_cut';
