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
