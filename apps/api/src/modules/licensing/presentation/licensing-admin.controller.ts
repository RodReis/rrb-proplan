import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import {
  AuthenticatedRequest,
  JwtAuthGuard,
} from '../../identity/presentation/jwt-auth.guard';
import { TenantContextInterceptor } from '../../identity/presentation/tenant-context.interceptor';
import { TenantGuard } from '../../identity/presentation/tenant.guard';
import {
  LicenseAdminService,
  type IssueLicenseInput,
} from '../application/license-admin.service';
import {
  LicCatalogService,
  type CreateEditionInput,
  type CreateProductInput,
} from '../application/lic-catalog.service';
import { LicenseSigningService } from '../application/license-signing.service';

interface RevokeBody {
  reason?: unknown;
}

interface EditionLimitsBody {
  maxMachines?: unknown;
  updatesMonths?: unknown;
}

/**
 * Admin do licenciamento (SPEC-036 §Contratos → Admin).
 *
 * Tudo autenticado e sob contexto de tenant. A rota **pública** do `/activate`
 * vive em controller próprio (PR-3), sem guard — separados em arquivos
 * distintos pelo mesmo motivo do `contracts`: é o que impede uma rota pública
 * de nascer por engano dentro do controller protegido, ou de ser adicionada ao
 * público sem ninguém notar que ali não há sessão.
 *
 * **A chave em claro sai por exatamente um caminho:** a resposta do `POST
 * /licenses`. Nenhum `GET` daqui a devolve, porque nenhum tem de onde tirá-la —
 * o banco guarda só o hash.
 */
@Controller('t/:tenant/licensing')
@UseGuards(JwtAuthGuard, TenantGuard)
@UseInterceptors(TenantContextInterceptor)
export class LicensingAdminController {
  constructor(
    private readonly licenses: LicenseAdminService,
    private readonly catalog: LicCatalogService,
    private readonly signing: LicenseSigningService,
  ) {}

  /**
   * Produtos e edições do tenant.
   *
   * `signingConfigured` viaja junto de propósito: sem a chave privada no
   * ambiente, emitir funciona mas o `/activate` devolveria `503` na hora em que
   * o comprador tentasse usar. A tela avisa **antes** de alguém emitir e
   * entregar uma chave que não ativa.
   */
  @Get('catalog')
  async catalogView(@Req() req: AuthenticatedRequest) {
    return {
      products: await this.catalog.listProducts(req.tenantId!),
      signingConfigured: this.signing.isConfigured,
    };
  }

  @Post('products')
  createProduct(
    @Req() req: AuthenticatedRequest,
    @Body() body: CreateProductInput,
  ) {
    return this.catalog.createProduct(req.tenantId!, body ?? {});
  }

  @Post('products/:id/editions')
  createEdition(
    @Req() req: AuthenticatedRequest,
    @Param('id') productId: string,
    @Body() body: CreateEditionInput,
  ) {
    return this.catalog.createEdition(req.tenantId!, productId, body ?? {});
  }

  /**
   * Ajusta os limites da edição. `PATCH` e não `PUT`: `slug` e `billingModel`
   * **não** são alteráveis — o primeiro viaja no license file já emitido, o
   * segundo muda o significado de `expiresAt` numa licença viva.
   */
  @Patch('editions/:id')
  updateEdition(
    @Req() req: AuthenticatedRequest,
    @Param('id') editionId: string,
    @Body() body: EditionLimitsBody,
  ) {
    return this.catalog.updateEditionLimits(req.tenantId!, editionId, body ?? {});
  }

  /**
   * Licenças do tenant. `?email=` filtra; `?key=` busca pela chave (hasheia e
   * procura por `keyHash`) — o caminho do suporte, em que o comprador manda a
   * chave e o admin confere sem que o servidor jamais a tenha guardado.
   */
  @Get('licenses')
  async list(
    @Req() req: AuthenticatedRequest,
    @Query('email') email?: string,
    @Query('key') key?: string,
  ) {
    if (key) {
      const achada = await this.licenses.findByKey(req.tenantId!, key);
      // Lista de 0 ou 1, não 404: a tela consome uma lista nos dois casos, e
      // "não achei" é resposta legítima de uma busca, não erro.
      return achada ? [achada] : [];
    }
    return this.licenses.list(req.tenantId!, email);
  }

  /**
   * Emite a licença. **A resposta contém a chave em claro — uma única vez.**
   * Nenhuma leitura posterior a devolve; perder significa emitir outra.
   */
  @Post('licenses')
  issue(@Req() req: AuthenticatedRequest, @Body() body: IssueLicenseInput) {
    return this.licenses.issue(req.tenantId!, body ?? {});
  }

  /**
   * Revoga. `POST` numa sub-rota, e não `DELETE` na licença: a licença **não é
   * apagada** — ela passa a existir revogada, com data e motivo, porque é isso
   * que o `/activate` lê para responder `410` e o que explica a decisão meses
   * depois.
   */
  @Post('licenses/:id/revoke')
  revoke(
    @Req() req: AuthenticatedRequest,
    @Param('id') licenseId: string,
    @Body() body: RevokeBody,
  ) {
    return this.licenses.revoke(
      req.tenantId!,
      licenseId,
      typeof body?.reason === 'string' ? body.reason : '',
    );
  }

  /** Trilha da licença — `issued`, `activated`, `reactivated`, `revoked`. */
  @Get('licenses/:id/events')
  events(@Req() req: AuthenticatedRequest, @Param('id') licenseId: string) {
    return this.licenses.events(req.tenantId!, licenseId);
  }
}
