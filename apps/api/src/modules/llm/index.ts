/**
 * Superfície pública do módulo `llm` (ADR-027, decisão 2).
 *
 * **Este arquivo é a fronteira.** Nada fora de `modules/llm/**` importa de
 * `llm/application/**`, `llm/domain/**` ou `llm/infrastructure/**` — o
 * `llm-public-surface.arch.spec.ts` quebra o build se acontecer.
 *
 * O motivo de a fronteira ser um arquivo, e não só o `exports` do `@Module`:
 * o `exports` do Nest resolve **injeção de dependência**, não resolve o import
 * de TypeScript, que é onde o acoplamento mora. Um módulo com `exports` certo e
 * imports profundos livres tem a *aparência* de fronteira — e fronteira que
 * aparenta existir é pior que fronteira ausente, porque ninguém audita o que já
 * parece resolvido (ADR-027, alternativa rejeitada nº 2).
 *
 * Precisa de algo que não está aqui? **Peça a exportação** — a discussão sobre
 * a fronteira acontece no PR, que é onde ela deve acontecer.
 */

// O módulo Nest (providers + controller de /usage/llm).
export { LlmModule } from './llm.module';

// A porta e seu contrato (ADR-008). Adapters concretos são detalhe interno.
export type { LlmClient, LlmRequest, LlmResponse } from './domain/llm-client';
export { LLM_CLIENT } from './domain/llm-client';

// Resolve o adapter do provedor ativo. Quem chama modelo entra por aqui.
export { LlmClientFactory } from './infrastructure/llm-client.factory';

// Ledger append-only do consumo (ADR-016): grava toda chamada, com custo
// congelado na escrita.
export { LlmUsageRecorder } from './application/llm-usage.recorder';

// Gate do teto por tenant (ADR-026). O §2.6 da SPEC-032 manda verificar antes
// de enfileirar e antes de cada capacidade.
export { UsageService } from './application/usage.service';
export type { CurrentMonthUsage } from './application/usage.service';
