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
import { CatalogService } from '../application/catalog.service';

/** Rota `projects/:id/freshness` (fora do prefixo `catalog`) — ADR-010. */
@Controller('t/:tenant/projects/:id')
@UseGuards(JwtAuthGuard, TenantGuard, RoleGuard)
@UseInterceptors(TenantContextInterceptor)
export class FreshnessController {
  constructor(private readonly catalog: CatalogService) {}

  @Get('freshness')
  freshness(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    return this.catalog.freshness(req.userId, id);
  }
}
