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
  UnprocessableEntityException,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import type { LicenseStatus } from '@prisma/client';
import {
  AuthenticatedRequest,
  JwtAuthGuard,
} from '../../identity/presentation/jwt-auth.guard';
import {
  ReleaseAdminService,
  type CreateReleaseInput,
  type UpdateReleaseInput,
} from '../application/release-admin.service';
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
import { ErrorReportAdminService } from '../application/error-report-admin.service';
import {
  LicensingOpsService,
  type OfferMappingInput,
  type UpdateSettingsInput,
} from '../application/licensing-ops.service';
import { LicensePrivacyService } from '../application/license-privacy.service';
import { LicensingSummaryService } from '../application/licensing-summary.service';
import { SourceAdminService } from '../application/source-admin.service';
import { DEFAULT_PERIOD, isPeriod } from '../domain/period';

/**
 * Os três estados de licença (`LicenseStatus` do schema). Escritos aqui e não
 * importados do `@prisma/client` como valor porque o enum do Prisma é um objeto
 * em runtime, e a rota precisa validar uma **string de query** contra ele — o
 * teste abaixo prende os dois lados: se o enum ganhar um estado, ele falha.
 */
const LICENSE_STATUSES: readonly LicenseStatus[] = ['ACTIVE', 'REVOKED', 'EXPIRED'];

function isLicenseStatus(valor: string): valor is LicenseStatus {
  return (LICENSE_STATUSES as readonly string[]).includes(valor);
}

interface RevokeBody {
  reason?: unknown;
}

interface ExtendBody {
  until?: unknown;
  reason?: unknown;
}

interface AnonymizeBody {
  reason?: unknown;
}

interface EditionLimitsBody {
  maxMachines?: unknown;
  updatesMonths?: unknown;
  /** FIX #214 — o que o webhook lê para agendar o convite ao repo source. */
  grantsSourceAccess?: unknown;
}

interface ProductBody {
  /** `owner/name`, ou string vazia para limpar. */
  sourceRepo?: unknown;
  /** URL pública do instalador (SPEC-042), ou string vazia para limpar. */
  downloadUrl?: unknown;
  /** URL pública do manual (SPEC-042), ou string vazia para limpar. */
  manualUrl?: unknown;
}

interface GithubUsernameBody {
  username?: unknown;
}

interface PatBody {
  githubPat?: unknown;
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
    private readonly source: SourceAdminService,
    private readonly privacy: LicensePrivacyService,
    private readonly summaries: LicensingSummaryService,
    private readonly releases: ReleaseAdminService,
    private readonly errorReports: ErrorReportAdminService,
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
   * Edita os campos configuráveis do produto: repositório de código-fonte
   * (FIX #212), link de download e link do manual (SPEC-042).
   *
   * **`PATCH` é literal aqui, não convenção**: cada campo ausente do corpo fica
   * como está. A tela salva um de cada vez, então tratar ausente como "limpar"
   * faria o primeiro save apagar os outros dois.
   *
   * Uma rota para os três, e não uma por coluna — a `/source-repo` nasceu sozinha
   * porque era a única, e repetir esse desenho a cada campo novo é como esta área
   * acumulou três colunas sem caminho pela interface.
   */
  @Patch('products/:id')
  updateProduct(
    @Req() req: AuthenticatedRequest,
    @Param('id') productId: string,
    @Body() body: ProductBody,
  ) {
    return this.catalog.updateProduct(req.tenantId!, productId, body ?? {});
  }

  /**
   * Ajusta os limites da edição e o acesso ao código-fonte. `PATCH` e não `PUT`:
   * `slug` e `billingModel` **não** são alteráveis — o primeiro viaja no license
   * file já emitido, o segundo muda o significado de `expiresAt` numa licença
   * viva.
   *
   * `grantsSourceAccess` **é** alterável (FIX #214): ele só decide o que acontece
   * nas compras futuras, e licença já emitida carrega o próprio `sourceInviteAt`.
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
   * Licenças do tenant. **`?q=` é um campo só, casando cinco colunas**
   * (SPEC-040): e-mail, nome, `saleRef`, username do GitHub e a chave — esta
   * por hash, o caminho do suporte em que o comprador manda a chave e o admin
   * confere sem que o servidor jamais a tenha guardado. `?status=` filtra por
   * cima.
   *
   * **`?email=` e `?key=` deixaram de existir**, e nada os substitui em
   * separado: eram dois campos na tela para uma pergunta só — *"acha a licença
   * deste cliente"* —, e o operador tinha de saber de antemão em qual deles
   * colar o que o cliente mandou. Errar o campo devolvia lista vazia, que é
   * indistinguível de "não existe".
   *
   * `status` inválido é **recusado**, nunca ignorado em silêncio: ignorar faria
   * uma lista completa passar por lista filtrada, e o operador concluiria que
   * não há revogadas quando só errou o valor.
   */
  @Get('licenses')
  async list(
    @Req() req: AuthenticatedRequest,
    @Query('q') q?: string,
    @Query('status') status?: string,
  ) {
    if (status && !isLicenseStatus(status)) {
      throw new UnprocessableEntityException(`Status inválido: ${status}`);
    }
    return this.licenses.list(req.tenantId!, q, status as LicenseStatus | undefined);
  }

  /**
   * As contagens do painel (SPEC-040 §Métricas). **Nenhum valor monetário** —
   * o tipo da resposta não tem campo de valor, e há teste afirmando isso.
   *
   * **Período fora da lista fechada é RECUSADO, nunca corrigido para o padrão**
   * (§6 da SPEC-035): corrigir em silêncio faria um erro de front virar
   * contagem plausível de uma janela que ninguém pediu — e ninguém descobriria,
   * porque o número apareceria normal.
   *
   * Um bloco por rota seriam seis requisições para uma tela só; a tela mostra
   * todos juntos, então a resposta vem junta — mesmo raciocínio do detalhe
   * agregado.
   */
  @Get('summary')
  summary(@Req() req: AuthenticatedRequest, @Query('period') period?: string) {
    // O padrão é resolvido AQUI e passado explícito: deixar `undefined` seguir
    // adiante faria o "30" morar em dois lugares — a rota e o service —, e eles
    // divergiriam na primeira mudança.
    if (!period) {
      return this.summaries.summary(req.tenantId!, DEFAULT_PERIOD);
    }
    if (!isPeriod(period)) {
      throw new UnprocessableEntityException(`Período inválido: ${period}`);
    }
    return this.summaries.summary(req.tenantId!, period);
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
   * Estende a validade — **conserto pontual, não segunda fonte de verdade**
   * (SPEC-040 §Estender). `expiresAt` tem uma autoridade: a plataforma. Esta
   * extensão assume que o próximo evento de renovação vence, e o que a torna
   * administrável é o aviso na tela + o valor anterior gravado no evento.
   *
   * `POST` numa sub-rota e não `PATCH` na licença: é um **ato** com autor e
   * motivo, não a edição de um campo.
   */
  @Post('licenses/:id/extend')
  extend(
    @Req() req: AuthenticatedRequest,
    @Param('id') licenseId: string,
    @Body() body: ExtendBody,
  ) {
    return this.privacy.extend(req.tenantId!, licenseId, req.userId, body ?? {});
  }

  /**
   * Exclusão a pedido (LGPD, SPEC-040 §Exclusão a pedido).
   *
   * **`POST` e não `DELETE`, e a diferença é a ação inteira**: nada é apagado.
   * A licença, as ativações, a trilha e o `saleRef` permanecem — o que sai é
   * quem é a pessoa. Um `DELETE` aqui prometeria remoção da linha, que é
   * justamente o que não se faz: apagaria a prova da transação, inclusive a
   * prova de que a exclusão foi feita.
   */
  @Post('licenses/:id/anonymize')
  anonymize(
    @Req() req: AuthenticatedRequest,
    @Param('id') licenseId: string,
    @Body() body: AnonymizeBody,
  ) {
    return this.privacy.anonymize(req.tenantId!, licenseId, req.userId, body ?? {});
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

  /**
   * As ofertas que já apareceram nas entregas e ainda não têm mapeamento.
   *
   * Existe porque o cadastro pedia um id que **o operador não tem**: ele nasce
   * dentro do payload da venda e não aparece em tela nenhuma da plataforma que
   * se copie. Aqui a tela oferece o que já chegou, em vez de pedir um uuid
   * transcrito à mão da mensagem de erro.
   */
  @Get('seen-offers')
  seenOffers(@Query('take') take?: string) {
    return this.ops.listSeenOffers(take ? Number(take) : undefined);
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

  // =========================================================================
  // Acesso ao repo source (SPEC-039, PR-5) — as rotas que tiram do beco as três
  // pendências que os PRs 3 e 4 gravam: sem username, convite não aceito e
  // `FAILED`. Nenhuma se resolve sozinha, e a edição com código-fonte é a mais
  // cara do catálogo.
  // =========================================================================

  /**
   * Licenças que pedem ação. **Quem classifica o motivo é o servidor** — uma tela
   * que o deduzisse do enum duplicaria a regra, e as duas divergiriam na primeira
   * mudança.
   */
  @Get('source-pending')
  sourcePending(@Req() req: AuthenticatedRequest) {
    return this.source.pending(req.tenantId!);
  }

  /**
   * Grava ou substitui o username (decisão PI #4: **só pelo admin** — nenhum
   * caminho self-service reabre token que dá acesso a código-fonte).
   *
   * Valida o login no GitHub antes de gravar e cancela o convite pendente, se
   * houver: sem isso o username errado seguiria podendo aceitar o convite antigo
   * e o certo nunca receberia o novo.
   */
  @Put('licenses/:id/github-username')
  setGithubUsername(
    @Req() req: AuthenticatedRequest,
    @Param('id') licenseId: string,
    @Body() body: GithubUsernameBody,
  ) {
    return this.source.setUsername(req.tenantId!, licenseId, body?.username);
  }

  /**
   * Reemite o convite rodando a **reconciliação do tenant** — o mesmo caminho do
   * job, com as mesmas guardas. Por isso a resposta é o resultado da rodada
   * inteira: chamar de "reemitir a licença X" mentiria sobre o escopo.
   */
  @Post('licenses/:id/source-invite')
  reinvite(@Req() req: AuthenticatedRequest, @Param('id') licenseId: string) {
    return this.source.reinvite(req.tenantId!, licenseId);
  }

  /**
   * Revogação manual do acesso ao repo (§Revogação → gatilhos: reembolso,
   * chargeback e **manual**).
   *
   * `DELETE` aqui, e não `POST` numa sub-rota como o `revoke` da licença: o que se
   * apaga é o **acesso ao repositório**, que de fato deixa de existir — diferente
   * da licença, que passa a existir revogada, com data e motivo, porque é isso que
   * o `/activate` lê.
   *
   * **Não toca o `status` da licença**: remover do repo e revogar a licença são
   * atos diferentes.
   */
  @Delete('licenses/:id/source-access')
  removeSourceAccess(@Req() req: AuthenticatedRequest, @Param('id') licenseId: string) {
    return this.source.removeAccess(req.tenantId!, licenseId);
  }

  /** Configuração de source. O PAT **não** sai daqui — só `githubPatSet`. */
  @Get('source-settings')
  sourceSettings(@Req() req: AuthenticatedRequest) {
    return this.source.settings(req.tenantId!);
  }

  /** Grava o PAT, cifrado com o `TOKEN_ENCRYPTION_KEY` (decisão PI #2). */
  @Put('source-settings/pat')
  setPat(@Req() req: AuthenticatedRequest, @Body() body: PatBody) {
    return this.source.setPat(req.tenantId!, body?.githubPat);
  }

  /**
   * Teste de conexão — a metade que **antecipa** a falha do PAT.
   *
   * **PAT fine-grained expira** (limite do GitHub), e uma expiração silenciosa
   * pararia os convites sem nenhum erro visível. Este é o par da pendência
   * `FAILED`: um antecipa, o outro acusa.
   *
   * Nunca devolve erro HTTP por token ruim: o resultado *é* `{ ok: false, reason }`
   * — um `500` diria "o ProPlan quebrou" sobre um teste cuja resposta é "seu token
   * está errado".
   */
  @Post('source-settings/test')
  testSourceConnection(@Req() req: AuthenticatedRequest) {
    return this.source.testConnection(req.tenantId!);
  }

  // =========================================================================
  // Releases (SPEC-041, PR-4) - o registro do PONTEIRO. O binario vive na
  // Release privada do GitHub (ADR-028); aqui entra o `assetId` que o download
  // troca por URL assinada e o `sha256` que a maquina do cliente confere.
  //
  // **Sem upload de arquivo**, e isso nao e limitacao: o artefato ja esta
  // hospedado onde nasce. Subi-lo para ca seria pagar dump e memoria por uma
  // copia - e literalmente a decisao do ADR-028.
  // =========================================================================

  /** As releases do tenant, mais nova primeiro. Inclui as despublicadas. */
  @Get('releases')
  listReleases(@Req() req: AuthenticatedRequest, @Query('productId') productId?: string) {
    return this.releases.list(req.tenantId!, productId);
  }

  /**
   * Registra uma release. Validacao **no servidor**, antes do banco: os CHECKs
   * do PR-1 sao a ultima linha, mas uma violacao sobe como `23514` e vira `500`
   * na tela - dizendo "o ProPlan quebrou" sobre um "voce digitou o hash errado"
   * (FIX #216).
   */
  @Post('releases')
  createRelease(@Req() req: AuthenticatedRequest, @Body() body: CreateReleaseInput) {
    return this.releases.create(req.tenantId!, body ?? {});
  }

  /**
   * Corrige o ponteiro de uma release ja registrada (FIX #242).
   *
   * Nao aceita `version`, `os` nem `productId`: sao a identidade da linha
   * (o unique do banco), e a trilha de download aponta para ela. Sem esta rota,
   * um `assetId` digitado errado so saia por SQL - o `@@unique` recusa
   * recadastrar, e despublicar nao libera a chave.
   */
  @Patch('releases/:id')
  updateRelease(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() body: UpdateReleaseInput,
  ) {
    return this.releases.update(req.tenantId!, id, body ?? {});
  }

  /**
   * Despublica: some do `check` E do `download`. **Nao apaga a linha** - a
   * trilha de quem ja baixou aponta para ela.
   */
  @Post('releases/:id/unpublish')
  unpublishRelease(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    return this.releases.unpublish(req.tenantId!, id);
  }

  /**
   * Republica. Despublicar por engano e o erro provavel de um botao ao lado da
   * lista, e sem volta o operador teria de registrar a mesma versao de novo -
   * que o unique do banco recusa.
   */
  @Post('releases/:id/publish')
  publishRelease(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    return this.releases.publish(req.tenantId!, id);
  }

  /**
   * Relatos de erro do app (SPEC-043), com filtros por produto, versão e status.
   *
   * Sem `stack` nem `sessionTail`: são os campos grandes, e `sessionTail` é o
   * que carrega o risco de privacidade aceito pelo PI. Uma lista que os
   * trouxesse os exporia a cada abertura da aba, para todo relato — quem precisa
   * abre o item.
   */
  @Get('error-reports')
  listErrorReports(
    @Query('productId') productId?: string,
    @Query('appVersion') appVersion?: string,
    @Query('status') status?: string,
    @Query('take') take?: string,
  ) {
    return this.errorReports.list({
      productId,
      appVersion,
      status,
      take: take ? Number(take) : undefined,
    });
  }

  /** Agrupamento por mensagem com contagem — *"qual erro acontece mais?"*. */
  @Get('error-reports/groups')
  errorReportGroups(
    @Query('productId') productId?: string,
    @Query('appVersion') appVersion?: string,
    @Query('status') status?: string,
  ) {
    return this.errorReports.groups({ productId, appVersion, status });
  }

  /**
   * Um relato, com stack, sessionTail e **o e-mail do comprador correlacionado**
   * pela licença (§Critérios de aceite).
   */
  @Get('error-reports/:id')
  errorReport(@Param('id') id: string) {
    return this.errorReports.detail(id);
  }

  /** Triagem: `new` → `triaged` → `resolved`. */
  @Patch('error-reports/:id/status')
  setErrorReportStatus(@Param('id') id: string, @Body() body: { status?: unknown }) {
    return this.errorReports.setStatus(id, body?.status);
  }

  /**
   * Apaga relatos com mais de 90 dias (§Escopo).
   *
   * **Botão, porque o repo não tem agendador** — mesma situação do
   * `LicenseExpirySweepService` da SPEC-038, e a escolha de um é decisão de
   * infra que nenhuma spec tomou. A diferença está anotada no `STATUS.md`: um
   * sweep parado só desatualiza a lista, um purge parado é retenção de LGPD não
   * cumprida.
   */
  @Post('error-reports/purge')
  async purgeErrorReports(@Req() req: AuthenticatedRequest) {
    const removed = await this.errorReports.purge(req.tenantId!);
    return { removed };
  }
}
