/** Fila do processamento de webhook de venda (SPEC-038, ADR-004). */
export const LICENSING_QUEUE = 'licensing';

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

/** Fila do job que materializa `status=EXPIRED` para o admin (SPEC-038, PR-4). */
export const LICENSING_SWEEP_JOB = 'expire-licenses';
