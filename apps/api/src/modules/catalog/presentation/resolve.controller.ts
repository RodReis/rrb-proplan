import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import {
  AuthenticatedRequest,
  JwtAuthGuard,
} from '../../identity/presentation/jwt-auth.guard';
import { CatalogService } from '../application/catalog.service';

/**
 * `GET /resolve?tenant=<slug|uuid>&project=<slug|uuid>` (SPEC-028): traduz os
 * tokens da URL nos ids canônicos, para o deep-link/F5 em
 * `/t/:tenantSlug/p/:projectSlug` não precisar do catálogo global inteiro.
 *
 * Rota GLOBAL, como o resto do catálogo (ADR-020): só `JwtAuthGuard`. Sem
 * `TenantGuard`/`TenantContextInterceptor` — não há `:tenant` no path para eles
 * resolverem, e é justamente o que este endpoint existe para descobrir. O
 * contexto RLS é aberto no service, a partir do `userId` da sessão.
 *
 * Responde **404** (e não o 403 do `TenantGuard`) para tenant/projeto alheio ou
 * inexistente — ver `resolveSlugs`. Rotas distintas com jobs distintos; ambas
 * não-diferenciais, então nenhuma vaza existência.
 */
@Controller('resolve')
@UseGuards(JwtAuthGuard)
export class ResolveController {
  constructor(private readonly catalog: CatalogService) {}

  @Get()
  resolve(
    @Req() req: AuthenticatedRequest,
    @Query('tenant') tenant: string,
    @Query('project') project: string,
  ) {
    return this.catalog.resolveSlugs(req.userId, tenant ?? '', project ?? '');
  }
}
