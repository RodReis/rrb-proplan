import { Controller, Get, Param, Req, UseGuards } from '@nestjs/common';
import {
  AuthenticatedRequest,
  JwtAuthGuard,
} from '../../identity/presentation/jwt-auth.guard';
import { CanonicalService } from '../application/canonical.service';

@Controller('projects/:id')
@UseGuards(JwtAuthGuard)
export class CanonicalController {
  constructor(private readonly canonical: CanonicalService) {}

  /**
   * Modelo canônico do projeto (SPEC-014): entidades → campos, cada um com
   * proveniência + confiança + a conta, ou recusa abaixo do limiar. Sem IA
   * (ADR-002) — lê o CanonicalField já persistido pelo sync.
   */
  @Get('canonical')
  getModel(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    return this.canonical.getCanonicalModel(req.userId, id);
  }
}
