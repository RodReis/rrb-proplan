import { Injectable } from '@nestjs/common';
import { LlmProvider } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';

export interface SettingsView {
  llmProvider: LlmProvider;
  docsStalenessThresholdDays: number;
  /** Provedores com chave no .env — os demais ficam desabilitados na UI. */
  availableProviders: LlmProvider[];
}

export interface UpdateSettingsInput {
  llmProvider?: LlmProvider;
  docsStalenessThresholdDays?: number;
}

@Injectable()
export class SettingsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Settings do usuário, criando a linha padrão (Anthropic, 90d) se faltar. */
  async get(userId: string): Promise<SettingsView> {
    const s = await this.prisma.settings.upsert({
      where: { userId },
      create: { userId },
      update: {},
    });
    return {
      llmProvider: s.llmProvider,
      docsStalenessThresholdDays: s.docsStalenessThresholdDays,
      availableProviders: availableProviders(),
    };
  }

  async update(
    userId: string,
    input: UpdateSettingsInput,
  ): Promise<SettingsView> {
    // Não deixar selecionar provedor sem chave — quebraria em runtime.
    if (input.llmProvider && !availableProviders().includes(input.llmProvider)) {
      throw new Error(`Provedor ${input.llmProvider} não tem chave configurada`);
    }
    const threshold = input.docsStalenessThresholdDays;
    if (threshold !== undefined && (threshold < 0 || !Number.isInteger(threshold))) {
      throw new Error('Limiar de defasagem deve ser inteiro >= 0');
    }
    await this.prisma.settings.upsert({
      where: { userId },
      create: {
        userId,
        llmProvider: input.llmProvider,
        docsStalenessThresholdDays: threshold,
      },
      update: {
        llmProvider: input.llmProvider,
        docsStalenessThresholdDays: threshold,
      },
    });
    return this.get(userId);
  }

  /** Interface pública: limiar de defasagem (catalog usa em /freshness). */
  async thresholdDaysOf(userId: string): Promise<number> {
    return (await this.get(userId)).docsStalenessThresholdDays;
  }

  /** Interface pública: provedor ativo (insight usa ao inferir). */
  async providerOf(userId: string): Promise<LlmProvider> {
    return (await this.get(userId)).llmProvider;
  }
}

/** Provedores com chave presente no ambiente (ADR-008). */
export function availableProviders(): LlmProvider[] {
  const out: LlmProvider[] = [];
  if (process.env.ANTHROPIC_API_KEY) out.push('anthropic');
  if (process.env.OPENAI_API_KEY) out.push('openai');
  if (process.env.OPENROUTER_API_KEY) out.push('openrouter');
  return out;
}
