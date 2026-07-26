import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Req,
  UnprocessableEntityException,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import {
  AuthenticatedRequest,
  JwtAuthGuard,
} from '../../identity/presentation/jwt-auth.guard';
import { TenantGuard } from '../../identity/presentation/tenant.guard';
import {
  RoleGuard,
  RequireRole,
} from '../../identity/presentation/require-role.decorator';
import { TenantContextInterceptor } from '../../identity/presentation/tenant-context.interceptor';
import { BriefingLinkService } from '../application/briefing-link.service';

interface LinkBody {
  expiresAt?: string | null;
}

/**
 * Gestão do link de briefing pelo prestador — rota autenticada `/t/:tenant`
 * (SPEC-029). O par público desta rota é o `BriefingPublicController`.
 *
 * `viewer` vê o estado do link (GET); criar, regenerar, revogar e mexer na
 * expiração exigem `member`.
 */
@Controller('t/:tenant/client-projects/:id/briefing-link')
@UseGuards(JwtAuthGuard, TenantGuard, RoleGuard)
@UseInterceptors(TenantContextInterceptor)
export class BriefingLinkController {
  constructor(private readonly links: BriefingLinkService) {}

  /** Metadados do link ativo — nunca o token (não é recuperável por design). */
  @Get()
  get(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    return this.links.getActive(req.tenantId!, id);
  }

  /**
   * Gera ou regenera. A resposta traz o token em claro — **única vez** que ele
   * existe fora do cliente; regenerar revoga o anterior.
   */
  @Post()
  @RequireRole('member')
  create(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() body: LinkBody = {},
  ) {
    return this.links.createOrRegenerate(
      req.tenantId!,
      id,
      parseExpiration(body.expiresAt),
    );
  }

  @Patch()
  @RequireRole('member')
  setExpiration(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() body: LinkBody,
  ) {
    return this.links.setExpiration(
      req.tenantId!,
      id,
      parseExpiration(body.expiresAt),
    );
  }

  @Delete()
  @RequireRole('member')
  revoke(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    return this.links.revoke(req.tenantId!, id);
  }
}

/**
 * Valida a data na fronteira: string inválida viraria `Invalid Date` e seria
 * gravada como NULL pelo Prisma — um link que o operador acha que expira e que
 * na prática nunca expira. Fail-fast com 422 em vez disso.
 */
function parseExpiration(value?: string | null): Date | null {
  if (value === undefined || value === null || value === '') return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new UnprocessableEntityException('expiresAt inválido');
  }
  return date;
}
