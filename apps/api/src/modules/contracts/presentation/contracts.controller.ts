import {
  Body,
  Controller,
  Delete,
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
  ContractIssueService,
  type IssueContractInput,
} from '../application/contract-issue.service';
import { ContractLinkService } from '../application/contract-link.service';
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
 * Perfil do prestador, templates e **emissão do contrato** (SPEC-034 §6).
 *
 * Tudo autenticado e sob `withTenant` — a rota **pública** do contrato
 * (`GET /c/:token`) vive em controller próprio, sem guard, e chega no PR-4.
 *
 * **Nenhum `PATCH`/`PUT`/`DELETE` sobre conteúdo versionado.** Duas exceções
 * deliberadas, ambas sobre coisas que **não são** conteúdo versionado:
 *
 * - `PUT /provider-profile` — perfil é um só por tenant, substituído por
 *   inteiro, e cada contrato já guarda o seu `providerSnapshot` (PR-1), que é o
 *   que preserva o dado como estava no dia da emissão.
 * - `DELETE /contracts/:id/link` — o link é **credencial de acesso**, não
 *   documento. Revogar não toca o contrato: o `renderedHtml` continua imutável
 *   e legível no painel; o que morre é a URL pública (§2.8).
 *
 * Salvar template é `POST .../versions`, porque ali nada é alterado no lugar.
 */
@Controller('t/:tenant')
@UseGuards(JwtAuthGuard, TenantGuard)
@UseInterceptors(TenantContextInterceptor)
export class ContractsController {
  constructor(
    private readonly profile: ProviderProfileService,
    private readonly templates: ContractTemplateService,
    private readonly contracts: ContractIssueService,
    private readonly links: ContractLinkService,
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

  /**
   * Emite o contrato — o snapshot (§2.5).
   *
   * `POST` e nunca `PUT`/`PATCH`: refazer **emite versão nova**, e a anterior
   * continua legível porque pode já ter sido enviada ao cliente. Emitir **não
   * move o card** (§2.6) — quem move é o aceite, no PR-5.
   */
  @Post('client-projects/:id/contracts')
  issueContract(
    @Req() req: AuthenticatedRequest,
    @Param('id') clientProjectId: string,
    @Body() body: IssueContractInput,
  ) {
    return this.contracts.issue(req.tenantId!, clientProjectId, body ?? {}, req.userId);
  }

  /** As versões emitidas do projeto (§2.13). */
  @Get('client-projects/:id/contracts')
  listContracts(
    @Req() req: AuthenticatedRequest,
    @Param('id') clientProjectId: string,
  ) {
    return this.contracts.list(req.tenantId!, clientProjectId);
  }

  /** Um contrato, com o HTML renderizado — leitura no painel do prestador. */
  @Get('contracts/:id')
  contract(@Req() req: AuthenticatedRequest, @Param('id') contractId: string) {
    return this.contracts.byId(req.tenantId!, contractId);
  }

  /** Estado do link ativo — nunca o token, que não é recuperável (§2.13). */
  @Get('contracts/:id/link')
  contractLink(@Req() req: AuthenticatedRequest, @Param('id') contractId: string) {
    return this.links.getActive(req.tenantId!, contractId);
  }

  /**
   * Gera ou regenera o link público (§2.8).
   *
   * `POST` e não `PUT`: regenerar **revoga o anterior e cria outro**, com token
   * novo. O token em claro sai na resposta uma única vez — depois disso só o
   * hash existe, e nem o painel consegue relê-lo.
   */
  @Post('contracts/:id/link')
  createContractLink(
    @Req() req: AuthenticatedRequest,
    @Param('id') contractId: string,
  ) {
    return this.links.createOrRegenerate(req.tenantId!, contractId);
  }

  /**
   * Revogação em 1 clique, com efeito imediato (§2.8).
   *
   * `DELETE` sobre o **link**, não sobre o contrato — e é a única exceção ao
   * "nenhum verbo destrutivo neste controller": o link é credencial de acesso,
   * não conteúdo versionado. O contrato em si continua imutável, e revogar não
   * o toca.
   */
  @Delete('contracts/:id/link')
  revokeContractLink(
    @Req() req: AuthenticatedRequest,
    @Param('id') contractId: string,
  ) {
    return this.links.revoke(req.tenantId!, contractId);
  }
}
