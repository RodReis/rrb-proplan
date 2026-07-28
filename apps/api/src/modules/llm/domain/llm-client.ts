/** Mensagem no formato comum aos dois adapters (system + user). */
export interface LlmRequest {
  system: string;
  user: string;
  /** Limite de tokens de saída. */
  maxTokens: number;
  /**
   * Modelo desta chamada, sobrepondo o do adapter. **Opcional de propósito**:
   * quem não passa continua no modelo global do env, que é o comportamento de
   * todo chamador anterior a 2026-07-28.
   *
   * Existe porque a SPEC-032 §2.4 decide **um modelo só para a frente inteira
   * (Haiku)**, enquanto o `insight` roda no modelo global. Sem o override, as
   * opções seriam rodar o pipeline no modelo caro ou trocar o env global e
   * mudar o `insight` junto — efeito colateral fora da fatia.
   *
   * Não é o mapeamento tier→modelo que o ADR-008 rejeita: não há tabela de
   * complexidade escolhendo modelo, é um chamador declarando o seu.
   */
  model?: string;
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
  /**
   * Modelo que será enviado ao provedor (resolvido do env). Entra no inputHash
   * (SPEC-011) — trocar de modelo é input novo. É o modelo REQUISITADO, não o
   * que a resposta relata em `LlmResponse.model` (que pode ser um alias
   * resolvido pelo provedor); a chave de invalidação usa o requisitado.
   */
  readonly model: string;
  complete(req: LlmRequest): Promise<LlmResponse>;
}

export const LLM_CLIENT = Symbol('LLM_CLIENT');
