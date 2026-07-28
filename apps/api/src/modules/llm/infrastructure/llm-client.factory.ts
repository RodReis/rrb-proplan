import { Injectable } from '@nestjs/common';
import { LlmProvider } from '@prisma/client';
import { LlmClient } from '../domain/llm-client';
import { AnthropicClient } from './anthropic.client';
import { openaiClient, openrouterClient } from './openai-compat.client';

/** Resolve o adapter concreto a partir do provedor configurado (ADR-008). */
@Injectable()
export class LlmClientFactory {
  constructor(private readonly anthropic: AnthropicClient) {}

  create(provider: LlmProvider): LlmClient {
    switch (provider) {
      case 'anthropic':
        return this.anthropic;
      case 'openai':
        return openaiClient();
      case 'openrouter':
        return openrouterClient();
    }
  }
}
