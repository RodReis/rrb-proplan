import { Injectable } from '@nestjs/common';
import { LlmProvider, Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';

export interface SettingsView {
  llmProvider: LlmProvider;
  docsStalenessThresholdDays: number;
  /** Teto de gasto de IA (SPEC-009), USD/mês. String para preservar Decimal no JSON. */
  llmAlertUsdMonthly: string;
  llmHardCapUsdMonthly: string;
  /** Provedores com chave no .env — os demais ficam desabilitados na UI. */
  availableProviders: LlmProvider[];
}

export interface UpdateSettingsInput {
  llmProvider?: LlmProvider;
  docsStalenessThresholdDays?: number;
  llmAlertUsdMonthly?: string;
  llmHardCapUsdMonthly?: string;
}

@Injectable()
export class SettingsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Settings do usuário, criando a linha padrão (Anthropic, 90d, 5/20 USD) se faltar. */
  async get(userId: string): Promise<SettingsView> {
    const s = await this.prisma.settings.upsert({
      where: { userId },
      create: { userId },
      update: {},
    });
    return {
      llmProvider: s.llmProvider,
      docsStalenessThresholdDays: s.docsStalenessThresholdDays,
      llmAlertUsdMonthly: s.llmAlertUsdMonthly.toString(),
      llmHardCapUsdMonthly: s.llmHardCapUsdMonthly.toString(),
      availableProviders: availableProviders(),
    };
  }

  /** Teto de gasto de IA do usuário (SPEC-009). Usado pelo gate do UsageService. */
  async capsOf(userId: string): Promise<{ alert: Prisma.Decimal; hardCap: Prisma.Decimal }> {
    const s = await this.prisma.settings.upsert({
      where: { userId },
      create: { userId },
      update: {},
    });
    return { alert: s.llmAlertUsdMonthly, hardCap: s.llmHardCapUsdMonthly };
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
    const alert = parseUsd(input.llmAlertUsdMonthly, 'Alerta de gasto');
    const hardCap = parseUsd(input.llmHardCapUsdMonthly, 'Teto de gasto');
    await this.prisma.settings.upsert({
      where: { userId },
      create: {
        userId,
        llmProvider: input.llmProvider,
        docsStalenessThresholdDays: threshold,
        ...(alert !== undefined ? { llmAlertUsdMonthly: alert } : {}),
        ...(hardCap !== undefined ? { llmHardCapUsdMonthly: hardCap } : {}),
      },
      update: {
        llmProvider: input.llmProvider,
        docsStalenessThresholdDays: threshold,
        ...(alert !== undefined ? { llmAlertUsdMonthly: alert } : {}),
        ...(hardCap !== undefined ? { llmHardCapUsdMonthly: hardCap } : {}),
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

  /** Preços de modelo cadastrados (mais recente por modelo). Tela de Uso de IA. */
  async modelPrices() {
    const rows = await this.prisma.modelPrice.findMany({
      orderBy: [{ provider: 'asc' }, { model: 'asc' }, { effectiveFrom: 'desc' }],
    });
    return rows.map((p) => ({
      id: p.id,
      provider: p.provider,
      model: p.model,
      inputPer1M: p.inputPer1M.toString(),
      outputPer1M: p.outputPer1M.toString(),
      cacheWritePer1M: p.cacheWritePer1M.toString(),
      cacheReadPer1M: p.cacheReadPer1M.toString(),
      effectiveFrom: p.effectiveFrom.toISOString(),
      source: p.source,
    }));
  }

  /**
   * Cria uma nova vigência de preço (nunca reescreve a anterior — o custo já
   * gravado usa o priceSnapshot; mudar aqui só afeta chamadas futuras, SPEC-009).
   */
  async upsertModelPrice(input: {
    provider: string;
    model: string;
    inputPer1M: string;
    outputPer1M: string;
    cacheWritePer1M?: string;
    cacheReadPer1M?: string;
    source?: string;
  }) {
    const effectiveFrom = new Date();
    await this.prisma.modelPrice.create({
      data: {
        provider: input.provider,
        model: input.model,
        inputPer1M: new Prisma.Decimal(input.inputPer1M),
        outputPer1M: new Prisma.Decimal(input.outputPer1M),
        cacheWritePer1M: new Prisma.Decimal(input.cacheWritePer1M ?? '0'),
        cacheReadPer1M: new Prisma.Decimal(input.cacheReadPer1M ?? '0'),
        effectiveFrom,
        source: input.source,
      },
    });
    return this.modelPrices();
  }
}

/** Valida e converte um valor USD de teto (>= 0). `undefined` = não mexer. */
function parseUsd(value: string | undefined, label: string): Prisma.Decimal | undefined {
  if (value === undefined) return undefined;
  const d = new Prisma.Decimal(value);
  if (d.isNegative()) throw new Error(`${label} deve ser >= 0`);
  return d;
}

/** Provedores com chave presente no ambiente (ADR-008). */
export function availableProviders(): LlmProvider[] {
  const out: LlmProvider[] = [];
  if (process.env.ANTHROPIC_API_KEY) out.push('anthropic');
  if (process.env.OPENAI_API_KEY) out.push('openai');
  if (process.env.OPENROUTER_API_KEY) out.push('openrouter');
  return out;
}
