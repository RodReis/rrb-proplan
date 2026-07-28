import { Body, Controller, Get, Put, Req, UseGuards } from '@nestjs/common';
import {
  AuthenticatedRequest,
  JwtAuthGuard,
} from '../../identity/presentation/jwt-auth.guard';
import {
  SettingsService,
  UpdateSettingsInput,
} from '../application/settings.service';

@Controller('settings')
@UseGuards(JwtAuthGuard)
export class SettingsController {
  constructor(private readonly settings: SettingsService) {}

  @Get()
  get(@Req() req: AuthenticatedRequest) {
    return this.settings.get(req.userId);
  }

  @Put()
  update(@Req() req: AuthenticatedRequest, @Body() body: UpdateSettingsInput) {
    return this.settings.update(req.userId, body);
  }

  /**
   * Teto de gasto de IA do tenant (ADR-026). Separado de `/settings` porque o
   * dono é outro: aquilo é preferência de pessoa, isto é o bolso do tenant.
   * `canEditCaps` diz à tela se deve mostrar o controle — só `owner` escreve.
   */
  @Get('llm-caps')
  llmCaps(@Req() req: AuthenticatedRequest) {
    return this.settings.tenantCaps(req.userId);
  }

  @Put('llm-caps')
  updateLlmCaps(
    @Req() req: AuthenticatedRequest,
    @Body() body: { llmAlertUsdMonthly?: string; llmHardCapUsdMonthly?: string },
  ) {
    return this.settings.updateTenantCaps(req.userId, body);
  }

  @Get('model-prices')
  modelPrices() {
    return this.settings.modelPrices();
  }

  @Put('model-prices')
  upsertModelPrice(
    @Body()
    body: {
      provider: string;
      model: string;
      inputPer1M: string;
      outputPer1M: string;
      cacheWritePer1M?: string;
      cacheReadPer1M?: string;
      source?: string;
    },
  ) {
    return this.settings.upsertModelPrice(body);
  }
}
