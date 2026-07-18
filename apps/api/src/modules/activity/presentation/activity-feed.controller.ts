import {
  Controller,
  Get,
  Param,
  Query,
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
import { ActivityService } from '../application/activity.service';

/**
 * Painel de Atividade por projeto (SPEC-010, Camada 2). "Agora" (operações em
 * curso) + "Histórico" (projeção de leitura, paginada). Ownership no service.
 */
@Controller('t/:tenant/projects/:id/activity')
@UseGuards(JwtAuthGuard, TenantGuard, RoleGuard)
@UseInterceptors(TenantContextInterceptor)
export class ActivityFeedController {
  constructor(private readonly activity: ActivityService) {}

  /** Operações em curso — seção "Agora". */
  @Get('running')
  async running(@Req() req: AuthenticatedRequest, @Param('id') projectId: string) {
    return this.activity.running(req.userId, projectId);
  }

  /** Histórico paginado. `includeSyncs=true` revela os syncs (inclusive noop). */
  @Get()
  async feed(
    @Req() req: AuthenticatedRequest,
    @Param('id') projectId: string,
    @Query('cursor') cursor?: string,
    @Query('includeSyncs') includeSyncs?: string,
  ) {
    return this.activity.feed(req.userId, projectId, {
      cursor,
      includeSyncs: includeSyncs === 'true',
    });
  }
}
