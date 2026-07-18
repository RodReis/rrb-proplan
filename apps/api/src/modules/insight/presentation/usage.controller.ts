import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import {
  AuthenticatedRequest,
  JwtAuthGuard,
} from '../../identity/presentation/jwt-auth.guard';
import { UsageService } from '../application/usage.service';

/**
 * Consumo de IA (SPEC-009). `current-month` alimenta o gate/faixa; o relatório
 * por intervalo alimenta a tela de Uso de IA. Usuário único no MVP — o gasto é
 * do dono logado; o relatório soma o banco todo (um provedor ativo por vez).
 */
@Controller('usage/llm')
@UseGuards(JwtAuthGuard)
export class UsageController {
  constructor(private readonly usage: UsageService) {}

  @Get('current-month')
  async currentMonth(@Req() req: AuthenticatedRequest) {
    return this.usage.currentMonth(req.userId);
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
    return this.usage.report(req.userId, fromDate, toDate);
  }
}
