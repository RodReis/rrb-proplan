import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
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
import { ContextService } from '../application/context.service';

@Controller('t/:tenant/projects/:id/assertions')
@UseGuards(JwtAuthGuard, TenantGuard, RoleGuard)
@UseInterceptors(TenantContextInterceptor)
export class ContextController {
  constructor(private readonly context: ContextService) {}

  @Get()
  async list(@Req() req: AuthenticatedRequest, @Param('id') projectId: string) {
    return { assertions: await this.context.list(req.userId, projectId) };
  }

  /** Captura (SPEC-015): write-back em docs/CONTEXT.md via Operation. 202 + operationId. */
  @Post()
  @HttpCode(202)
  capture(
    @Req() req: AuthenticatedRequest,
    @Param('id') projectId: string,
    @Body() body: { statement: string; paths: string[]; body?: string },
  ) {
    return this.context.capture(req.userId, projectId, body);
  }

  /** Confirma uma asserção `a-revalidar`: renova data+sha, volta a `vigente`. */
  @Post(':assertionId/revalidate')
  @HttpCode(202)
  revalidate(
    @Req() req: AuthenticatedRequest,
    @Param('id') projectId: string,
    @Param('assertionId') assertionId: string,
  ) {
    return this.context.revalidate(req.userId, projectId, assertionId);
  }
}
