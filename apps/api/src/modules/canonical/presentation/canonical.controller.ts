import {
  Controller,
  Get,
  Param,
  Req,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import {
  AuthenticatedRequest,
  JwtAuthGuard,
} from '../../identity/presentation/jwt-auth.guard';
import { TenantGuard } from '../../identity/presentation/tenant.guard';
import { RoleGuard } from '../../identity/presentation/require-role.decorator';
import { TenantContextInterceptor } from '../../identity/presentation/tenant-context.interceptor';
import { CanonicalService } from '../application/canonical.service';

@Controller('t/:tenant/projects/:id')
@UseGuards(JwtAuthGuard, TenantGuard, RoleGuard)
@UseInterceptors(TenantContextInterceptor)
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
