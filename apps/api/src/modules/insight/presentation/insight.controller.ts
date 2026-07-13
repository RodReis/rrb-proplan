import {
  Controller,
  Get,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  AuthenticatedRequest,
  JwtAuthGuard,
} from '../../identity/presentation/jwt-auth.guard';
import { InsightService } from '../application/insight.service';

@Controller('projects/:id')
@UseGuards(JwtAuthGuard)
export class InsightController {
  constructor(private readonly insight: InsightService) {}

  @Get('insights/summary')
  summary(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    return this.insight.latestSummary(req.userId, id);
  }

  // Regeneração é síncrona (1 chamada de IA, ~segundos): a UI mostra "gerando…"
  // durante o await e recebe o resumo pronto — sem polling. ponytail: se a
  // latência incomodar, promover para job com polling (padrão do sync).
  @Post('insights/summary/regenerate')
  async regenerate(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    await this.insight.regenerate(req.userId, id);
    return this.insight.latestSummary(req.userId, id);
  }
}
// O bootstrap de STATUS.md (proposeStatus/commitStatus) da SPEC-003 foi
// substituído pelo fluxo de cards do board (SPEC-005): POST /board/bootstrap
// (propõe cards por IA) + /board/bootstrap/apply (cria as issues).
