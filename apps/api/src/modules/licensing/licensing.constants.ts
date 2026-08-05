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
 * Nome do job recorrente da reconciliação do convite ao source, e a chave da
 * idempotência (SPEC-048, ADR-029).
 *
 * Mesmo papel duplo do `CATALOG_SYNC_JOB`: id do `upsertJobScheduler` e
 * discriminador no `job.name` que o worker roteia. **Também é o nome do job do
 * gatilho por evento** — o `add` disparado ao gravar o username entra na mesma
 * fila com este nome, e o worker não distingue um do outro. Isso é deliberado:
 * a rodada é a mesma, só muda quem a pediu.
 */
export const SOURCE_RECONCILE_JOB = 'source-reconcile';

/**
 * Uma hora depois do sync do catálogo (SPEC-048 §Contratos).
 *
 * O que a spec exige não é o horário, é **não coincidir** com o sync (`0 3`) nem
 * com o sweep (`0 5`). O `concurrency: 1` da fila já serializa a execução, mas
 * serialização não é o ponto: horários distintos são o que permite ler *"a
 * rodada das 4h falhou"* sem desembaraçar três execuções do mesmo minuto.
 */
export const SOURCE_RECONCILE_CRON = '0 4 * * *';

/**
 * Nome do job recorrente que materializa `EXPIRED` (SPEC-048, ADR-029).
 *
 * O `LicenseExpirySweepService` existe e é testado desde a SPEC-038, e **nenhum
 * código o chamava** — esta constante é o que o liga.
 */
export const EXPIRY_SWEEP_JOB = 'expiry-sweep';

/**
 * Uma hora depois da reconciliação do convite (SPEC-048 §Contratos).
 *
 * Mesmo critério do `SOURCE_RECONCILE_CRON`: o valor é proposta, a exigência é
 * ser distinto dos outros dois.
 */
export const EXPIRY_SWEEP_CRON = '0 5 * * *';

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
