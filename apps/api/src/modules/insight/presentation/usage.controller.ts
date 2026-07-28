import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import {
  AuthenticatedRequest,
  JwtAuthGuard,
} from '../../identity/presentation/jwt-auth.guard';
import { SettingsService } from '../../settings/application/settings.service';
import { UsageService } from '../application/usage.service';

/**
 * Consumo de IA (SPEC-009). `current-month` alimenta o gate/faixa; o relatório
 * por intervalo alimenta a tela de Uso de IA.
 *
 * O gasto é POR TENANT (ADR-026), então o controller resolve o tenant do
 * usuário logado e passa adiante — o service não recebe pessoa. Estas rotas são
 * globais (sem `TenantGuard`), daí a resolução aqui e não no guard.
 */
@Controller('usage/llm')
@UseGuards(JwtAuthGuard)
export class UsageController {
  constructor(
    private readonly usage: UsageService,
    private readonly settings: SettingsService,
  ) {}

  @Get('current-month')
  async currentMonth(@Req() req: AuthenticatedRequest) {
    const tenantId = await this.settings.personalTenantId(req.userId);
    return this.usage.currentMonth(tenantId);
  }

  @Get()
  async report(
    @Req() req: AuthenticatedRequest,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    // Padrão: mês corrente. Datas ISO opcionais.
    const now = new Date();
    const fromDate = from ? new Date(from) : new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const toDate = to ? new Date(to) : new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
    const tenantId = await this.settings.personalTenantId(req.userId);
    return this.usage.report(tenantId, fromDate, toDate);
  }
}
