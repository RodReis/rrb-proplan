import { Injectable } from '@nestjs/common';
import { LlmClient, LlmRequest, LlmResponse } from '../domain/llm-client';

const ANTHROPIC_TIMEOUT_MS = 120_000; // job, não request (ARCHITECTURE.md)

/** Adapter Anthropic Messages API (ADR-008). Provedor padrão. */
@Injectable()
export class AnthropicClient implements LlmClient {
  readonly provider = 'anthropic';
  /** Modelo que SERÁ enviado — entra no inputHash (SPEC-011), resolvido antes da chamada. */
  readonly model = process.env.LLM_MODEL_ANTHROPIC ?? 'claude-sonnet-5';

  async complete(req: LlmRequest): Promise<LlmResponse> {
    // `req.model` sobrepõe o do adapter quando o chamador declara o seu
    // (SPEC-032 §2.4). Sem ele, o modelo global do env — o comportamento de
    // todo chamador anterior.
    const model = req.model ?? this.model;
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': process.env.ANTHROPIC_API_KEY ?? '',
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model,
        max_tokens: req.maxTokens,
        system: req.system,
        messages: [{ role: 'user', content: req.user }],
      }),
      signal: AbortSignal.timeout(ANTHROPIC_TIMEOUT_MS),
    });
    if (!res.ok) {
      throw new Error(`Anthropic API ${res.status}: ${await res.text()}`);
    }
    const body = (await res.json()) as {
      content: Array<{ type: string; text?: string }>;
      model: string;
      usage: {
        input_tokens: number;
        output_tokens: number;
        cache_creation_input_tokens?: number;
        cache_read_input_tokens?: number;
      };
    };
    const text = body.content
      .filter((c) => c.type === 'text')
      .map((c) => c.text ?? '')
      .join('');
    return {
      text,
      model: body.model,
      inputTokens: body.usage.input_tokens,
      outputTokens: body.usage.output_tokens,
      // Anthropic devolve write e read separados; ausente → 0 (SPEC-009).
      cacheCreationTokens: body.usage.cache_creation_input_tokens ?? 0,
      cacheReadTokens: body.usage.cache_read_input_tokens ?? 0,
    };
  }
}
