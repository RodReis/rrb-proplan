import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  AuthenticatedRequest,
  JwtAuthGuard,
} from '../../identity/presentation/jwt-auth.guard';
import { BootstrapService } from '../application/bootstrap.service';
import { InsightService } from '../application/insight.service';

@Controller('projects/:id')
@UseGuards(JwtAuthGuard)
export class InsightController {
  constructor(
    private readonly insight: InsightService,
    private readonly bootstrap: BootstrapService,
  ) {}

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

  @Post('bootstrap/status')
  proposeStatus(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    return this.bootstrap.proposeStatus(req.userId, id);
  }

  @Post('bootstrap/status/commit')
  @HttpCode(202)
  commitStatus(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() body: { content: string },
  ) {
    return this.bootstrap.commitStatus(req.userId, id, body.content);
  }
}
