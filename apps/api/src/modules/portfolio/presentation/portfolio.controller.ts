import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import {
  AuthenticatedRequest,
  JwtAuthGuard,
} from '../../identity/presentation/jwt-auth.guard';
import { PortfolioService } from '../application/portfolio.service';

@Controller('portfolio')
@UseGuards(JwtAuthGuard)
export class PortfolioController {
  constructor(private readonly portfolio: PortfolioService) {}

  /**
   * Portfólio da fábrica (SPEC-019): linhas cross-projeto com os sinais crus e
   * datados, já ordenadas pelo radar de risco. Sem IA (ADR-002) — projeção do
   * cache persistido; não cria LlmUsage.
   */
  @Get()
  get(@Req() req: AuthenticatedRequest) {
    return this.portfolio.getPortfolio(req.userId);
  }
}
