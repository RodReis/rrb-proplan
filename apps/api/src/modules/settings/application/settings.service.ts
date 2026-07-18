import { Injectable } from '@nestjs/common';
import { LlmProvider, Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';

export interface SettingsView {
  llmProvider: LlmProvider;
  docsStalenessThresholdDays: number;
  /** Teto de gasto de IA (SPEC-009), USD/mês. String para preservar Decimal no JSON. */
  llmAlertUsdMonthly: string;
  llmHardCapUsdMonthly: string;
  /** Limiar de recusa do modelo canônico (SPEC-014). 0..1; 0 desliga. */
  canonicalRefusalThreshold: number;
  /** Provedores com chave no .env — os demais ficam desabilitados na UI. */
  availableProviders: LlmProvider[];
}

export interface UpdateSettingsInput {
  llmProvider?: LlmProvider;
  docsStalenessThresholdDays?: number;
  llmAlertUsdMonthly?: string;
  llmHardCapUsdMonthly?: string;
  canonicalRefusalThreshold?: number;
}

@Injectable()
export class SettingsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Tenant pessoal do usuário (SPEC-022). Settings é por tenant e a tabela tem
   * RLS — as rotas de settings/usage são globais (sem TenantGuard), então o
   * contexto é aberto aqui, com o tenant do próprio usuário. No 1º corte há um
   * tenant pessoal por usuário (1:1); se houver mais, usa o owner (billing/teto
   * moram no tenant que o dono administra). Deriva do userId autenticado.
   */
  async personalTenantId(userId: string): Promise<string> {
    const m = await this.prisma.membership.findFirst({
      where: { userId },
      // enum Role declarado owner|member|viewer → 'asc' traz owner primeiro (o
      // tenant que o usuário administra, dono do teto/billing).
      orderBy: { role: 'asc' },
      select: { tenantId: true },
    });
    if (!m) throw new Error(`Usuário ${userId} sem tenant — migração incompleta`);
    return m.tenantId;
  }

  /** Settings do usuário, criando a linha padrão (Anthropic, 90d, 5/20 USD) se faltar. */
  async get(userId: string): Promise<SettingsView> {
    const tenantId = await this.personalTenantId(userId);
    const s = await this.prisma.withTenant([tenantId], (tx) =>
      tx.settings.upsert({
        where: { userId },
        create: { userId, tenantId },
        update: {},
      }),
    );
    return {
      llmProvider: s.llmProvider,
      docsStalenessThresholdDays: s.docsStalenessThresholdDays,
      llmAlertUsdMonthly: s.llmAlertUsdMonthly.toString(),
      llmHardCapUsdMonthly: s.llmHardCapUsdMonthly.toString(),
      canonicalRefusalThreshold: s.canonicalRefusalThreshold,
      availableProviders: availableProviders(),
    };
  }

  /** Teto de gasto de IA do tenant (ADR-016 por tenant). Gate do UsageService. */
  async capsOf(userId: string): Promise<{ alert: Prisma.Decimal; hardCap: Prisma.Decimal }> {
    const tenantId = await this.personalTenantId(userId);
    const s = await this.prisma.withTenant([tenantId], (tx) =>
      tx.settings.upsert({
        where: { userId },
        create: { userId, tenantId },
        update: {},
      }),
    );
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
    const canonThreshold = input.canonicalRefusalThreshold;
    if (canonThreshold !== undefined && (canonThreshold < 0 || canonThreshold > 1)) {
      throw new Error('Limiar de recusa deve estar entre 0 e 1');
    }
    const alert = parseUsd(input.llmAlertUsdMonthly, 'Alerta de gasto');
    const hardCap = parseUsd(input.llmHardCapUsdMonthly, 'Teto de gasto');
    const canon = canonThreshold !== undefined ? { canonicalRefusalThreshold: canonThreshold } : {};
    const tenantId = await this.personalTenantId(userId);
    await this.prisma.withTenant([tenantId], (tx) =>
    tx.settings.upsert({
      where: { userId },
      create: {
        userId,
        tenantId,
        llmProvider: input.llmProvider,
        docsStalenessThresholdDays: threshold,
        ...(alert !== undefined ? { llmAlertUsdMonthly: alert } : {}),
        ...(hardCap !== undefined ? { llmHardCapUsdMonthly: hardCap } : {}),
        ...canon,
      },
      update: {
        llmProvider: input.llmProvider,
        docsStalenessThresholdDays: threshold,
        ...(alert !== undefined ? { llmAlertUsdMonthly: alert } : {}),
        ...(hardCap !== undefined ? { llmHardCapUsdMonthly: hardCap } : {}),
        ...canon,
      },
    }),
    );
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

  /** Interface pública: limiar de recusa do modelo canônico (SPEC-014). */
  async canonicalThresholdOf(userId: string): Promise<number> {
    return (await this.get(userId)).canonicalRefusalThreshold;
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
