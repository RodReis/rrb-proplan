import { Controller, Get, Param, Req, UseGuards, UseInterceptors } from '@nestjs/common';
import {
  AuthenticatedRequest,
  JwtAuthGuard,
} from '../../identity/presentation/jwt-auth.guard';
import { TenantGuard } from '../../identity/presentation/tenant.guard';
import { TenantContextInterceptor } from '../../identity/presentation/tenant-context.interceptor';
import { BriefingReadService } from '../application/briefing-read.service';

/**
 * Leitura do briefing no painel do prestador (SPEC-031 §6).
 *
 * **Só `@Get`, e isso é o contrato.** A `BriefingVersion` é imutável (spec §5):
 * não existe `PATCH`/`PUT`/`DELETE` sobre ela em papel nenhum — nem para o
 * prestador, nem para a IA. Há teste varrendo as rotas deste módulo para provar
 * que continua assim.
 *
 * **Nenhum `RequireRole`, de propósito.** O critério de aceite da spec §6 é
 * literal: *"`viewer` lê; ninguém edita"*. Restringir a leitura por papel
 * contradiria a spec, e não há escrita para proteger.
 */
@Controller('t/:tenant')
@UseGuards(JwtAuthGuard, TenantGuard)
@UseInterceptors(TenantContextInterceptor)
export class BriefingReadController {
  constructor(private readonly read: BriefingReadService) {}

  /** Estado do briefing do projeto + as versões enviadas (mais nova primeiro). */
  @Get('client-projects/:id/briefing')
  status(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    return this.read.getStatus(req.tenantId!, id);
  }

  /** Uma versão em leitura: respostas, rótulos resolvidos e anexos. */
  @Get('briefing-versions/:id')
  version(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    return this.read.getVersion(req.tenantId!, id);
  }
}
