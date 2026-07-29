import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Patch,
  Query,
  Req,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import {
  AuthenticatedRequest,
  JwtAuthGuard,
} from '../../identity/presentation/jwt-auth.guard';
import { TenantContextInterceptor } from '../../identity/presentation/tenant-context.interceptor';
import { TenantGuard } from '../../identity/presentation/tenant.guard';
import { DashboardSettingsService } from '../application/dashboard-settings.service';
import { DashboardService } from '../application/dashboard.service';
import { DEFAULT_PERIOD, PERIODS, isPeriod, type Period } from '../domain/period';

/**
 * O dashboard (SPEC-035 §6).
 *
 * **Tudo autenticado e sob `withTenant`** — não há rota pública nesta fatia. O
 * `tenantId` vem do `TenantGuard` (derivado da membership), nunca do corpo da
 * request (regra 1 do ADR-020).
 *
 * As rotas de repos ao vivo (§2.6) ficam de fora deste controller de propósito:
 * a falha delas não pode contaminar a resposta principal (§2.11), e separar os
 * caminhos é o que torna essa garantia estrutural em vez de um `try/catch` que
 * alguém pode remover.
 */
@Controller('t/:tenant/dashboard')
@UseGuards(JwtAuthGuard, TenantGuard)
@UseInterceptors(TenantContextInterceptor)
export class DashboardController {
  constructor(
    private readonly dashboard: DashboardService,
    private readonly settings: DashboardSettingsService,
  ) {}

  /**
   * Blocos locais — tudo menos repos. **Uma chamada, não seis** (§6): o
   * dashboard é uma tela, e seis requests dariam seis estados de carregamento
   * numa página que deveria abrir pronta.
   */
  @Get()
  async view(@Req() req: AuthenticatedRequest, @Query('period') period?: string) {
    return this.dashboard.view(req.tenantId!, this.parsePeriod(period), new Date());
  }

  /**
   * Só o contador, para o menu (§6).
   *
   * Rota separada porque é chamada a cada navegação e não deve arrastar o
   * dashboard inteiro junto — mas o **caminho de dado é o mesmo** de `view`, que
   * é o que impede o número do menu de divergir da lista da tela (§2.3).
   *
   * Sem período: *Esperando você* é estado corrente, não janela (§2.8).
   */
  @Get('pending-count')
  async pendingCount(@Req() req: AuthenticatedRequest) {
    return this.dashboard.pendingCount(req.tenantId!, new Date());
  }

  /** O limite de "parado", em dias. */
  @Get('settings')
  async getSettings(@Req() req: AuthenticatedRequest) {
    return this.settings.get(req.tenantId!, req.role);
  }

  /** Altera o limite. **Só o `owner`** (ADR-026) — a guarda vive no service. */
  @Patch('settings')
  async updateSettings(
    @Req() req: AuthenticatedRequest,
    @Body() body: { stalledDays?: unknown },
  ) {
    const dias = Number(body?.stalledDays);
    return this.settings.update(req.tenantId!, req.role, dias);
  }

  /**
   * Período da URL → `Period`, ou **400**.
   *
   * Valor fora da lista é **recusado**, nunca corrigido em silêncio para o
   * padrão (§6): corrigir caladamente faria um erro de front virar dado errado
   * em tela — a contagem apareceria plausível, de uma janela que ninguém pediu.
   */
  private parsePeriod(bruto?: string): Period {
    if (bruto === undefined || bruto === '') return DEFAULT_PERIOD;
    if (!isPeriod(bruto)) {
      throw new BadRequestException(
        `período inválido: use um de ${PERIODS.join(', ')}`,
      );
    }
    return bruto;
  }
}
