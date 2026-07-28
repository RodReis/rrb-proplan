import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Put,
  Req,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import type { ContractModality } from '@prisma/client';
import {
  AuthenticatedRequest,
  JwtAuthGuard,
} from '../../identity/presentation/jwt-auth.guard';
import { TenantContextInterceptor } from '../../identity/presentation/tenant-context.interceptor';
import { TenantGuard } from '../../identity/presentation/tenant.guard';
import {
  ContractTemplateService,
} from '../application/contract-template.service';
import {
  ProviderProfileService,
  type UpsertProviderProfileInput,
} from '../application/provider-profile.service';

interface SaveTemplateBody {
  body?: unknown;
}

/**
 * Perfil do prestador e templates de contrato (SPEC-034 §6).
 *
 * Tudo autenticado e sob `withTenant` — a rota **pública** do contrato
 * (`GET /c/:token`) vive em controller próprio, sem guard, e chega no PR-4.
 *
 * **Nenhum `PATCH`/`PUT`/`DELETE` sobre conteúdo versionado.** O `PUT` do
 * perfil é a exceção deliberada, e a razão é que perfil **não é versionado**: é
 * um só por tenant, substituído por inteiro, e cada contrato já guarda o seu
 * `providerSnapshot` (PR-1) — que é o que preserva o dado como estava no dia da
 * emissão. Salvar template é `POST .../versions`, porque ali nada é alterado no
 * lugar.
 */
@Controller('t/:tenant')
@UseGuards(JwtAuthGuard, TenantGuard)
@UseInterceptors(TenantContextInterceptor)
export class ContractsController {
  constructor(
    private readonly profile: ProviderProfileService,
    private readonly templates: ContractTemplateService,
  ) {}

  /** Perfil do prestador. Leitura para qualquer membro do workspace. */
  @Get('provider-profile')
  providerProfile(@Req() req: AuthenticatedRequest) {
    return this.profile.get(req.tenantId!, req.role);
  }

  /** Cria ou substitui o perfil. **Só o `owner`** (§2.1). */
  @Put('provider-profile')
  saveProviderProfile(
    @Req() req: AuthenticatedRequest,
    @Body() body: UpsertProviderProfileInput,
  ) {
    return this.profile.upsert(req.tenantId!, req.role, body ?? {});
  }

  /** Os três templates, com o estado da trava de emissão de cada um. */
  @Get('contract-templates')
  listTemplates(@Req() req: AuthenticatedRequest) {
    return this.templates.list(req.tenantId!);
  }

  /** Um template, com o corpo da versão corrente. */
  @Get('contract-templates/:modality')
  template(
    @Req() req: AuthenticatedRequest,
    @Param('modality') modality: ContractModality,
  ) {
    return this.templates.detail(req.tenantId!, modality, req.role);
  }

  /** Histórico de versões — a anterior continua legível (§2.2). */
  @Get('contract-templates/:modality/versions')
  templateVersions(
    @Req() req: AuthenticatedRequest,
    @Param('modality') modality: ContractModality,
  ) {
    return this.templates.versions(req.tenantId!, modality);
  }

  /**
   * Salva uma versão nova. `POST`, não `PATCH`: editar **cria versão**, e um
   * contrato emitido aponta para a versão de que saiu.
   *
   * É este ato que tira o `isSeedExample` e destrava a emissão daquela
   * modalidade (§2.3).
   */
  @Post('contract-templates/:modality/versions')
  saveTemplateVersion(
    @Req() req: AuthenticatedRequest,
    @Param('modality') modality: ContractModality,
    @Body() body: SaveTemplateBody,
  ) {
    return this.templates.saveVersion(
      req.tenantId!,
      modality,
      req.role,
      body?.body,
      req.userId,
    );
  }
}
