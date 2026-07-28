import { Injectable } from '@nestjs/common';
import { LlmClient, LlmRequest, LlmResponse } from '../domain/llm-client';

const TIMEOUT_MS = 120_000;

interface OpenAiCompatConfig {
  provider: string;
  baseUrl: string;
  apiKey: string | undefined;
  model: string;
}

/**
 * Adapter para APIs no formato OpenAI Chat Completions (ADR-008).
 * Serve OpenAI e OpenRouter — mesmo protocolo, só muda baseURL/chave/modelo.
 */
export class OpenAiCompatClient implements LlmClient {
  readonly provider: string;
  /** Modelo que SERÁ enviado — entra no inputHash (SPEC-011). */
  readonly model: string;

  constructor(private readonly config: OpenAiCompatConfig) {
    this.provider = config.provider;
    this.model = config.model;
  }

  async complete(req: LlmRequest): Promise<LlmResponse> {
    const res = await fetch(`${this.config.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.config.apiKey ?? ''}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        // `req.model` sobrepõe o do adapter quando o chamador declara o seu
        // (SPEC-032 §2.4); sem ele, o modelo global do env.
        model: req.model ?? this.config.model,
        max_tokens: req.maxTokens,
        messages: [
          { role: 'system', content: req.system },
          { role: 'user', content: req.user },
        ],
        // OpenRouter devolve o custo real da chamada quando pedimos usage.
        ...(this.provider === 'openrouter' ? { usage: { include: true } } : {}),
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) {
      throw new Error(`${this.provider} API ${res.status}: ${await res.text()}`);
    }
    const body = (await res.json()) as {
      choices: Array<{ message: { content: string } }>;
      model: string;
      usage?: {
        prompt_tokens: number;
        completion_tokens: number;
        prompt_tokens_details?: { cached_tokens?: number };
        cost?: number; // OpenRouter: custo real em USD
      };
    };
    return {
      text: body.choices[0]?.message.content ?? '',
      model: body.model,
      inputTokens: body.usage?.prompt_tokens ?? 0,
      outputTokens: body.usage?.completion_tokens ?? 0,
      // OpenAI/OpenRouter só têm cache read; write não existe → 0 (SPEC-009).
      cacheCreationTokens: 0,
      cacheReadTokens: body.usage?.prompt_tokens_details?.cached_tokens ?? 0,
      // OpenRouter informa o custo → vence a nossa tabela (costSource: provider).
      ...(this.provider === 'openrouter' && typeof body.usage?.cost === 'number'
        ? { providerCostUsd: body.usage.cost }
        : {}),
    };
  }
}

/** Fábrica dos dois provedores OpenAI-compatíveis a partir do env. */
export function openaiClient(): OpenAiCompatClient {
  return new OpenAiCompatClient({
    provider: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    apiKey: process.env.OPENAI_API_KEY,
    model: process.env.LLM_MODEL_OPENAI ?? 'gpt-4o',
  });
}

export function openrouterClient(): OpenAiCompatClient {
  return new OpenAiCompatClient({
    provider: 'openrouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    apiKey: process.env.OPENROUTER_API_KEY,
    model: process.env.LLM_MODEL_OPENROUTER ?? 'anthropic/claude-3.5-sonnet',
  });
}
