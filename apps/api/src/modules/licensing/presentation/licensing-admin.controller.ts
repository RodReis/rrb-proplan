import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
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
import {
  LicensingOpsService,
  type OfferMappingInput,
  type UpdateSettingsInput,
} from '../application/licensing-ops.service';

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
    private readonly ops: LicensingOpsService,
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

  /**
   * Detalhe: as máquinas (inclusive desativadas, com a data) e o contador de
   * trocas da janela (SPEC-037).
   */
  @Get('licenses/:id')
  detail(@Req() req: AuthenticatedRequest, @Param('id') licenseId: string) {
    return this.licenses.detail(req.tenantId!, licenseId);
  }

  /**
   * Desativa uma máquina — o suporte manual de quando o self-service do
   * cliente não resolve (SPEC-037 §Escopo).
   *
   * `POST` numa sub-rota e não `DELETE` na ativação: a linha **não é apagada**
   * — ela passa a existir desativada, com data, porque é isso que mantém a
   * troca visível para quem for investigar depois.
   */
  @Post('licenses/:id/activations/:activationId/deactivate')
  deactivateActivation(
    @Req() req: AuthenticatedRequest,
    @Param('id') licenseId: string,
    @Param('activationId') activationId: string,
  ) {
    return this.licenses.deactivateActivation(req.tenantId!, licenseId, activationId);
  }

  /** Trilha da licença — `issued`, `activated`, `heartbeat`, `deactivated`, … */
  @Get('licenses/:id/events')
  events(@Req() req: AuthenticatedRequest, @Param('id') licenseId: string) {
    return this.licenses.events(req.tenantId!, licenseId);
  }

  // =========================================================================
  // Operação do webhook (SPEC-038, PR-5) — as rotas que tiram a venda parada
  // do beco. O PR-3 grava oferta não mapeada como `FAILED` de propósito; sem
  // estas rotas, esse estado é informação no banco que ninguém alcança.
  // =========================================================================

  /**
   * Entregas recebidas da plataforma, com filtro por status.
   *
   * `PENDING`/`FAILED` é o que o dono precisa ver — o resto é histórico. Sem o
   * `payload`: é corpo bruto com dado do comprador, e esta lista carrega
   * sempre. Quem precisa dele abre o item.
   */
  @Get('webhook-events')
  webhookEvents(@Query('status') status?: string, @Query('take') take?: string) {
    return this.ops.listWebhookEvents(status, take ? Number(take) : undefined);
  }

  /** Uma entrega, com o payload bruto — o que a plataforma realmente mandou. */
  @Get('webhook-events/:id')
  webhookEvent(@Param('id') id: string) {
    return this.ops.webhookEvent(id);
  }

  /**
   * Reenfileira a entrega. É o segundo passo do critério de aceite da fatia:
   * *"cadastrar o mapeamento e reprocessar o evento pendente emite a licença —
   * sem precisar da plataforma reenviar"*.
   */
  @Post('webhook-events/:id/reprocess')
  reprocess(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    return this.ops.reprocess(id, req.tenantId!);
  }

  /**
   * Configuração do tenant.
   *
   * **O `webhookSecret` não sai daqui** — só `webhookSecretSet`. O segredo é o
   * Token que a Kiwify gera (achado do PR-3), então a origem dele é o painel
   * dela: ninguém precisa lê-lo de volta, e uma tela que o exibisse seria
   * superfície de vazamento sem nada em troca.
   */
  @Get('settings')
  settings(@Req() req: AuthenticatedRequest) {
    return this.ops.settings(req.tenantId!);
  }

  /**
   * Grava segredo e/ou tolerância. Campo ausente não é tocado.
   *
   * `pastDueToleranceDays: null` é a mitigação sem deploy do risco aceito
   * (decisão PI #3) — desliga o corte por atraso. É por isso que `null` e
   * ausente têm de ser distinguíveis aqui.
   */
  @Put('settings')
  updateSettings(@Req() req: AuthenticatedRequest, @Body() body: UpdateSettingsInput) {
    return this.ops.updateSettings(req.tenantId!, body);
  }

  /** Mapeamentos oferta→edição: o de-para que resolve a compra em edição. */
  @Get('offer-mappings')
  offerMappings(@Req() req: AuthenticatedRequest) {
    return this.ops.listOfferMappings(req.tenantId!);
  }

  /** Cadastra o mapeamento — o ato que destrava a venda parada em `FAILED`. */
  @Post('offer-mappings')
  createOfferMapping(@Req() req: AuthenticatedRequest, @Body() body: OfferMappingInput) {
    return this.ops.createOfferMapping(req.tenantId!, body);
  }

  /**
   * Remove um mapeamento. **Não** toca licença já emitida: o mapeamento resolve
   * a compra no momento em que ela chega, e apagá-lo depois não desfaz nada.
   */
  @Delete('offer-mappings/:id')
  deleteOfferMapping(@Param('id') id: string) {
    return this.ops.deleteOfferMapping(id);
  }
}
