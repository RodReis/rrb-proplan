import {
  BadRequestException,
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
import { InsightService, RegenerableKind } from '../application/insight.service';

const REGENERABLE: readonly RegenerableKind[] = [
  'summary',
  'edges',
  'classify',
  'architecture_fallback',
  'design_fallback',
];

@Controller('projects/:id')
@UseGuards(JwtAuthGuard)
export class InsightController {
  constructor(private readonly insight: InsightService) {}

  @Get('insights/summary')
  summary(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    return this.insight.latestSummary(req.userId, id);
  }

  // Regeneração força a IA ignorando o inputHash (SPEC-011, item 5): único
  // caminho para reaplicar um provedor/modelo novo sobre docs inalterados
  // (ADR-008). Protegida pelo teto de gasto — o service lança
  // ForbiddenException (403) se o teto do mês foi atingido (SPEC-009).
  //
  // Síncrona (1 chamada de IA, ~segundos): a UI mostra "gerando…" durante o
  // await. ponytail: se a latência incomodar, promover para job com polling.
  @Post('insights/:kind/regenerate')
  async regenerate(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Param('kind') kind: string,
  ) {
    if (!REGENERABLE.includes(kind as RegenerableKind)) {
      throw new BadRequestException(`Inferência não regenerável: ${kind}`);
    }
    await this.insight.regenerate(req.userId, id, kind as RegenerableKind);
    // Só o summary tem leitura direta na Visão Geral; os demais aparecem nas
    // suas abas/grafo no próximo carregamento (o artefato já foi persistido).
    return kind === 'summary' ? this.insight.latestSummary(req.userId, id) : { ok: true };
  }
}
// O bootstrap de STATUS.md (proposeStatus/commitStatus) da SPEC-003 foi
// substituído pelo fluxo de cards do board (SPEC-005): POST /board/bootstrap
// (propõe cards por IA) + /board/bootstrap/apply (cria as issues).
