import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { SettingsService } from '../../settings/application/settings.service';

const D = Prisma.Decimal;

/** Primeiro instante do mês de uma data (UTC). */
function monthStart(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}
/** Primeiro instante do mês seguinte (UTC). */
function nextMonthStart(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1));
}

export interface CurrentMonthUsage {
  costUsd: string; // Decimal como string (preserva precisão no JSON)
  alertUsd: string;
  capUsd: string;
  blocked: boolean;
  /** Nº de chamadas sem preço cadastrado — o teto protege menos do que promete. */
  missingPriceCount: number;
}

/**
 * Gate e relatórios do gasto de IA (SPEC-009). A soma do teto é GLOBAL (todos os
 * provedores no mesmo mês — o bolso é um só, ADR-008 garante 1 provedor ativo por
 * vez). Chamadas com `priceMissing` NÃO entram na soma — e por isso o aviso "o
 * custo real é maior que o exibido" não pode ser escondido.
 */
@Injectable()
export class UsageService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
  ) {}

  /**
   * Gasto do mês corrente vs alerta/teto do usuário. `now` injetável para teste.
   * A verificação é `SUM(cost_usd)` do mês, de todos os provedores juntos.
   */
  async currentMonth(userId: string, now = new Date()): Promise<CurrentMonthUsage> {
    const { alert, hardCap } = await this.settings.capsOf(userId);
    const tenantId = await this.settings.personalTenantId(userId);
    const from = monthStart(now);
    const to = nextMonthStart(now);

    // llm_usage tem RLS — a soma do mês roda sob o contexto do tenant do usuário.
    // Linhas órfãs (tenant_id NULL, histórico pré-Fatia-8) entram pela policy
    // (F4: NULL pertence ao contexto ativo). O gasto é POR TENANT (ADR-016).
    const { agg, missingPriceCount } = await this.prisma.withTenant([tenantId], async (tx) => ({
      agg: await tx.llmUsage.aggregate({
        where: { createdAt: { gte: from, lt: to } },
        _sum: { costUsd: true },
      }),
      missingPriceCount: await tx.llmUsage.count({
        where: { createdAt: { gte: from, lt: to }, priceMissing: true },
      }),
    }));

    const spent = agg._sum.costUsd ?? new D(0);
    // Teto 0 desliga o bloqueio (SPEC-009).
    const blocked = hardCap.gt(0) && spent.gte(hardCap);

    return {
      costUsd: spent.toString(),
      alertUsd: alert.toString(),
      capUsd: hardCap.toString(),
      blocked,
      missingPriceCount,
    };
  }

  /**
   * Gate do teto: `true` = pode enfileirar/gastar. Barrar ANTES de gastar
   * (SPEC-009). Resolve o dono do projeto internamente (o Settings é por usuário).
   */
  async canSpend(projectId: string, now = new Date()): Promise<boolean> {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { userId: true },
    });
    if (!project) return false;
    const { blocked } = await this.currentMonth(project.userId, now);
    return !blocked;
  }

  /** Mesmo gate, mas já com o userId (endpoints que têm o usuário logado). */
  async canSpendForUser(userId: string, now = new Date()): Promise<boolean> {
    const { blocked } = await this.currentMonth(userId, now);
    return !blocked;
  }

  /**
   * Relatório de gasto num intervalo (tela de Consumo). Quebras por projeto,
   * tipo, provedor/modelo e status; taxa de desperdício (% em error/discarded);
   * total de tokens e nº de chamadas. Tudo derivado do `SUM` bruto do banco — a
   * UI não tem conta própria (critério de aceite).
   */
  async report(userId: string, from: Date, to: Date) {
    const where = { createdAt: { gte: from, lt: to } };
    const tenantId = await this.settings.personalTenantId(userId);

    // Relatório POR TENANT (ADR-016): llm_usage tem RLS, roda sob contexto.
    const { total, byProvider, byKind, byStatus, byProject, missingPriceCount } =
      await this.prisma.withTenant([tenantId], async (tx) => {
        const [total, byProvider, byKind, byStatus, byProject] = await Promise.all([
          tx.llmUsage.aggregate({
            where,
            _sum: { costUsd: true, inputTokens: true, outputTokens: true, cacheCreationTokens: true, cacheReadTokens: true },
            _count: true,
          }),
          tx.llmUsage.groupBy({ by: ['provider', 'model'], where, _sum: { costUsd: true }, _count: true }),
          tx.llmUsage.groupBy({ by: ['kind'], where, _sum: { costUsd: true }, _count: true }),
          tx.llmUsage.groupBy({ by: ['status'], where, _sum: { costUsd: true }, _count: true }),
          tx.llmUsage.groupBy({ by: ['projectId'], where, _sum: { costUsd: true }, _count: true }),
        ]);
        const missingPriceCount = await tx.llmUsage.count({ where: { ...where, priceMissing: true } });
        return { total, byProvider, byKind, byStatus, byProject, missingPriceCount };
      });

    const totalCost = total._sum.costUsd ?? new D(0);
    // Taxa de desperdício: % do custo em chamadas error/discarded. Denuncia bug.
    const wasted = byStatus
      .filter((s) => s.status === 'error' || s.status === 'discarded')
      .reduce((acc, s) => acc.add(s._sum.costUsd ?? new D(0)), new D(0));
    const wasteRate = totalCost.gt(0) ? wasted.div(totalCost).mul(100).toDecimalPlaces(1).toString() : '0';

    const money = (d: Prisma.Decimal | null) => (d ?? new D(0)).toString();
    return {
      totalCostUsd: money(totalCost),
      totalCalls: total._count,
      totalTokens:
        (total._sum.inputTokens ?? 0) +
        (total._sum.outputTokens ?? 0) +
        (total._sum.cacheCreationTokens ?? 0) +
        (total._sum.cacheReadTokens ?? 0),
      wasteRatePct: wasteRate,
      missingPriceCount,
      byProviderModel: byProvider.map((r) => ({ provider: r.provider, model: r.model, costUsd: money(r._sum.costUsd), calls: r._count })),
      byKind: byKind.map((r) => ({ kind: r.kind, costUsd: money(r._sum.costUsd), calls: r._count })),
      byStatus: byStatus.map((r) => ({ status: r.status, costUsd: money(r._sum.costUsd), calls: r._count })),
      byProject: byProject.map((r) => ({ projectId: r.projectId, costUsd: money(r._sum.costUsd), calls: r._count })),
    };
  }
}
