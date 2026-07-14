/** Mensagem no formato comum aos dois adapters (system + user). */
export interface LlmRequest {
  system: string;
  user: string;
  /** Limite de tokens de saída. */
  maxTokens: number;
}

export interface LlmResponse {
  /** Texto bruto retornado pelo modelo (esperado: JSON estrito). */
  text: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  /**
   * Uso normalizado de cache (SPEC-009). Cada adapter mapeia o formato do seu
   * provedor: Anthropic tem write+read; OpenAI só read (write = 0); provedor
   * sem o campo grava 0, NUNCA undefined — senão a soma agregada vira NULL.
   */
  cacheCreationTokens: number;
  cacheReadTokens: number;
  /**
   * Custo real informado pelo provedor (OpenRouter), em USD. Quando presente,
   * vence a nossa ModelPrice (costSource: provider). Ausente nos demais.
   */
  providerCostUsd?: number;
}

/**
 * Porta de saída do módulo insight (domain). Adapters concretos
 * (Anthropic, OpenAI-compatível) vivem em infrastructure. ADR-008.
 */
export interface LlmClient {
  readonly provider: string;
  complete(req: LlmRequest): Promise<LlmResponse>;
}

export const LLM_CLIENT = Symbol('LLM_CLIENT');
