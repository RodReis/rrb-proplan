import {
  Controller,
  Get,
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
import { HandoffService } from '../application/handoff.service';
import { HandoffCommitService } from '../application/handoff-commit.service';
import { renderHandoffMarkdown } from '../domain/handoff';

/**
 * Export do handoff (SPEC-018 §5). `GET` devolve a estrutura montada + o
 * markdown pronto (a UI mostra preview e oferece download); `POST /commit`
 * escreve `.proplan/HANDOFF.md`. Sem IA no caminho (ADR-002).
 */
@Controller('t/:tenant/projects/:id/handoff')
@UseGuards(JwtAuthGuard, TenantGuard, RoleGuard)
@UseInterceptors(TenantContextInterceptor)
export class HandoffController {
  constructor(
    private readonly handoff: HandoffService,
    private readonly commitSvc: HandoffCommitService,
  ) {}

  @Get()
  async get(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    const structure = await this.handoff.assemble(req.userId, id);
    return { structure, markdown: renderHandoffMarkdown(structure) };
  }

  @Post('commit')
  async commit(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    const committed = await this.commitSvc.commit(req.userId, id);
    return { committed };
  }
}
