/** Fila do processamento de webhook de venda (SPEC-038, ADR-004). */
export const LICENSING_QUEUE = 'licensing';

/**
 * Nome do job recorrente do sync de catálogo, e a **chave da idempotência**
 * (SPEC-047, ADR-029).
 *
 * `upsertJobScheduler` deduplica por este id: registrar de novo com os mesmos
 * valores **substitui** em vez de acrescentar. Sem uma chave estável, cada boot
 * da API somaria uma rodada — e duas instâncias no Railway já bastariam para
 * dobrar o sync.
 *
 * É também o que o worker lê para distinguir os dois tipos de job da **mesma
 * fila**: `webhook` processa uma venda, este varre os tenants.
 */
export const CATALOG_SYNC_JOB = 'catalog-sync';

/**
 * Madrugada, horário do servidor (SPEC-047).
 *
 * A hora exata não importa; o que importa é ser fora do horário em que alguém
 * compra — a Kiwify tem 100 req/min e o sync consome 1+N deles. A janela máxima
 * de exposição continua sendo 24h (§Escopo), e quem não quer esperar tem o botão.
 */
export const CATALOG_SYNC_CRON = '0 3 * * *';

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
