import {
  Body,
  Controller,
  HttpCode,
  HttpException,
  HttpStatus,
  Param,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { SlidingWindowRateLimiter } from '../../../shared/rate-limiter';
import {
  LicenseActivationService,
  type ActivateInput,
  type DeactivateInput,
  type HeartbeatInput,
} from '../application/license-activation.service';
import {
  LicenseReleaseService,
  type ReleaseCheckInput,
  type ReleaseDownloadInput,
} from '../application/license-release.service';
import {
  ErrorReportService,
  type ErrorReportInput,
} from '../application/error-report.service';
import { WebhookIntakeService } from '../application/webhook-intake.service';
import { hashKey } from '../domain/license-key';

/**
 * 10 requisições por minuto **por IP**, somando as três rotas. Nenhuma delas é
 * frequente por natureza: ativar acontece uma vez por máquina, o heartbeat é
 * diário (24 h ± 2 h) e desativar é raro. O que este limite estreita é a
 * varredura de chaves a partir de um IP.
 */
const IP_LIMIT = 10;
/**
 * 5 por minuto **por chave**, e o teto menor é deliberado: uma chave legítima
 * cobre 2 máquinas (o `maxMachines` do piloto), e cada uma bate uma vez por dia.
 * Mais que isso na mesma janela é chave compartilhada ou cliente em laço de
 * retry — e o laço de retry é justamente o que não deve passar despercebido.
 */
const KEY_LIMIT = 5;
/**
 * Relato de erro tem janela própria (SPEC-043 §Escopo), e mais folgada: um app
 * quebrando em laço manda vários relatos em segundos, e recusá-los pelo teto das
 * outras rotas descartaria justamente a evidência do bug mais grave — o que
 * repete. Continua sendo teto: 30/min por chave barra o cliente em loop infinito
 * de crash, que encheria a tabela sem acrescentar informação nenhuma.
 */
const ERROR_KEY_LIMIT = 30;
const RATE_WINDOW_MS = 60_000;
/** Poda o mapa a cada 5 min — ver `prune` no limitador. */
const PRUNE_INTERVAL_MS = 5 * 60_000;

/**
 * Rota PÚBLICA do licenciamento (SPEC-036 §Contratos) — **sem sessão**.
 *
 * Deliberadamente fora de `JwtAuthGuard`, `TenantGuard` e
 * `TenantContextInterceptor`: quem chama é o binário na máquina do comprador,
 * que não tem conta no ProPlan. O tenant é derivado do **hash da chave** dentro
 * do service (ADR-020), nunca de nada que venha no request.
 *
 * **`/licensing/v1` é contrato público e estável** (MVP4 §5): o cliente do War
 * Room é implementado contra ele, noutro repo. Mudança depois do piloto =
 * `/v2`, nunca quebra do `/v1`. O prefixo versionado existe por isso, e não por
 * simetria com o resto da API — nenhuma outra rota da casa é versionada.
 *
 * **Rate limit em duas chaves, não uma.** Só por IP deixaria a chave vazada
 * livre para ser ativada de mil endereços; só por chave deixaria a varredura de
 * chaves livre a partir de um IP. As duas portas precisam da tranca.
 */
@Controller('licensing/v1')
export class LicensingPublicController {
  private readonly ipLimiter = new SlidingWindowRateLimiter(IP_LIMIT, RATE_WINDOW_MS);
  private readonly keyLimiter = new SlidingWindowRateLimiter(KEY_LIMIT, RATE_WINDOW_MS);
  private readonly errorLimiter = new SlidingWindowRateLimiter(
    ERROR_KEY_LIMIT,
    RATE_WINDOW_MS,
  );
  private readonly pruneTimer: NodeJS.Timeout;

  constructor(
    private readonly activation: LicenseActivationService,
    private readonly webhook: WebhookIntakeService,
    private readonly releases: LicenseReleaseService,
    private readonly errorReports: ErrorReportService,
  ) {
    this.pruneTimer = setInterval(() => {
      this.ipLimiter.prune();
      this.keyLimiter.prune();
      this.errorLimiter.prune();
    }, PRUNE_INTERVAL_MS);
    // `unref`: um timer ativo seguraria o processo vivo no shutdown e travaria
    // os testes que sobem o módulo.
    this.pruneTimer.unref();
  }

  /**
   * Ativa uma máquina e devolve o license file assinado.
   *
   * `404` chave inexistente · `410` revogada ou expirada · `409` limite de
   * máquinas (com a lista, para a troca self-service da SPEC-037) · `429` rate
   * limit · `503` servidor sem chave de assinatura.
   */
  @Post('activate')
  async activate(@Body() body: ActivateInput, @Req() req: Request) {
    this.enforce(body, req);
    return this.activation.activate(body ?? {});
  }

  /**
   * Renova a janela offline: atualiza `lastSeenAt` e devolve o license file
   * **reassinado**, com `signedAt` novo (SPEC-037).
   *
   * `409` quando o fingerprint não está ativo — nunca reativa em silêncio, ou
   * bastaria pular o `/activate` para furar o `maxMachines`.
   */
  @Post('heartbeat')
  async heartbeat(@Body() body: HeartbeatInput, @Req() req: Request) {
    this.enforce(body, req);
    return this.activation.heartbeat(body ?? {});
  }

  /**
   * Libera uma vaga: `fingerprint` (a própria máquina) **ou** `activationId`
   * (outra, pelo id da lista do `409`) — nunca os dois.
   *
   * A segunda forma é o que faz a troca funcionar quando o computador antigo
   * não está mais acessível, que é o caso comum de quem trocou de máquina.
   */
  @Post('deactivate')
  async deactivate(@Body() body: DeactivateInput, @Req() req: Request) {
    this.enforce(body, req);
    return this.activation.deactivate(body ?? {});
  }

  /**
   * Há versão nova para esta licença? (SPEC-041 §Contratos.)
   *
   * `404` chave inexistente · `409` fingerprint não ativo · `410`
   * revogada/expirada/inadimplente · `429` rate limit — os mesmos das outras
   * três, porque o gate é literalmente o mesmo código.
   *
   * **`update: false` cobre dois casos distintos e responde igual**: "já está na
   * mais nova autorizada" e "nenhuma release cabe na sua janela". O cliente age
   * do mesmo jeito nos dois (não baixa nada), e distinguir só serviria para
   * informar a quem sonda quantas releases existem.
   *
   * **Corpo, nunca query string** (§Contratos): a chave em query cairia no log de
   * acesso do servidor e do proxy — o mesmo vazamento que a decisão de não
   * persistir a chave existe para impedir.
   */
  @Post('releases/check')
  async releasesCheck(@Body() body: ReleaseCheckInput, @Req() req: Request) {
    this.enforce(body, req);
    return this.releases.check(body ?? {});
  }

  /**
   * Cunha a URL assinada do artefato (SPEC-041 §Contratos).
   *
   * `403` versão fora da janela de updates · `404` release inexistente ou
   * despublicada · `409` · `410` · `429` iguais aos do `check` · `503` quando o
   * PAT falta, não abre ou não tem `contents:read`.
   *
   * **Uma chamada, uma URL** — e é por isso que esta rota não é cacheável nem
   * idempotente na prática: a URL do GitHub expira em segundos a minutos, então
   * dois `download` seguidos devolvem endereços diferentes (é critério de aceite,
   * não efeito colateral). Guardar a resposta entregaria ao próximo cliente um
   * link já morto.
   *
   * **Conta no mesmo rate limit das outras**, por IP e por chave: quem varre
   * chaves não ganha uma quarta porta por a rota ser nova, e alternar entre
   * `check` e `download` não dobra a cota de ninguém.
   */
  @Post('releases/download')
  async releasesDownload(@Body() body: ReleaseDownloadInput, @Req() req: Request) {
    this.enforce(body, req);
    return this.releases.download(body ?? {});
  }

  /**
   * Relato de erro do app licenciado (SPEC-043 §Contratos) — `202 { received:
   * true }`.
   *
   * `401` para chave inexistente **ou revogada**, sem distinguir: quem reporta
   * um erro não tem nada a fazer com a diferença, e distinguir só serviria a
   * quem sonda. `429` no limite próprio da rota.
   *
   * **Nunca `413`.** Payload acima do cap é truncado e aceito (§Critérios de
   * aceite) — recusar por tamanho faria o crash mais interessante, o de stack
   * fundo e sessão longa, ser o único que não chega.
   *
   * **Rate limit por IP compartilhado, por chave dedicado.** O teto por IP
   * continua sendo o das outras rotas — é a porta da varredura, e ela não muda
   * de natureza por a rota ser nova. O teto por chave é próprio e mais alto: um
   * app em laço de crash manda vários relatos em segundos, e barrá-lo em 5/min
   * descartaria a evidência do bug que mais repete.
   */
  @Post('errors')
  @HttpCode(HttpStatus.ACCEPTED)
  async errors(@Body() body: ErrorReportInput, @Req() req: Request) {
    const ip = req.ip ?? req.socket?.remoteAddress ?? 'desconhecido';
    this.checar(this.ipLimiter, `ip:${ip}`);

    const bruto = typeof body?.licenseKey === 'string' ? body.licenseKey.trim() : '';
    if (bruto) this.checar(this.errorLimiter, `key:${hashKey(bruto)}`);

    return this.errorReports.receive(body ?? {});
  }

  /**
   * Webhook da plataforma de venda — **uma URL por tenant** (decisão PI #1).
   *
   * `200 { received: true }` sempre que a assinatura confere: inclusive para
   * evento duplicado, de tipo desconhecido, ou que vai falhar no processamento.
   * O resultado vive no registro, não na resposta — um `4xx` para o que nenhum
   * reenvio conserta (oferta sem mapeamento) faria a plataforma reenviar
   * indefinidamente algo que só o admin resolve.
   *
   * `401` para assinatura inválida/ausente, tenant inexistente e tenant sem
   * configuração. Os três respondem igual de propósito: distinguir diria a quem
   * sonda quais slugs existem e quais já vendem.
   *
   * **Fora do rate limit das outras três.** Elas protegem contra varredura de
   * chaves; aqui, recusar entrega legítima da plataforma por excesso de vendas
   * numa promoção seria transformar sucesso comercial em licença não emitida. A
   * assinatura já é a barreira — quem não a tem não passa, e quem a tem é a
   * plataforma.
   */
  @Post('webhooks/kiwify/:tenantSlug')
  async kiwifyWebhook(
    @Param('tenantSlug') tenantSlug: string,
    @Body() body: unknown,
    @Query('signature') signature: string | undefined,
    @Req() req: Request & { rawBody?: Buffer },
  ) {
    return this.webhook.receive({
      tenantSlug,
      // O body CRU, não o objeto parseado: a assinatura cobre os bytes que a
      // plataforma enviou, e `JSON.stringify` do objeto não os reproduz (ordem
      // de chaves, espaços, escapes). O `main.ts` liga `rawBody: true` por
      // isso; o fallback aqui só existe para não quebrar em teste que monta o
      // request à mão.
      rawBody: req.rawBody ?? Buffer.from(JSON.stringify(body ?? {})),
      payload: body,
      querySignature: signature,
      headers: req.headers as Record<string, string | undefined>,
    });
  }

  /**
   * Duas janelas independentes. A chave entra no limitador **hasheada**: o mapa
   * do limitador vive em memória e aparece em heap dump — guardar a chave em
   * claro ali desfaria, num despejo de memória, a decisão de nunca persistí-la.
   *
   * **`key` OU `licenseKey`, e o segundo nome não é descuido**: as três rotas da
   * SPEC-036/037 recebem `key`; as de release (SPEC-041) recebem `licenseKey`,
   * porque é assim que o contrato do `war-room update` foi especificado. Ler só
   * `key` deixaria as rotas novas com **metade da tranca** — o limite por IP
   * valeria, o por chave não —, e a falha seria muda: nada em log, e a varredura
   * de chaves a partir de IPs variados passaria pela porta que o teto de 5/min
   * existe para fechar.
   */
  private enforce(body: { key?: unknown; licenseKey?: unknown }, req: Request): void {
    const ip = req.ip ?? req.socket?.remoteAddress ?? 'desconhecido';
    this.checar(this.ipLimiter, `ip:${ip}`);

    const bruto = typeof body?.key === 'string' ? body.key : body?.licenseKey;
    const key = typeof bruto === 'string' ? bruto.trim() : '';
    if (key) this.checar(this.keyLimiter, `key:${hashKey(key)}`);
  }

  private checar(limiter: SlidingWindowRateLimiter, chave: string): void {
    const decisao = limiter.check(chave);
    if (!decisao.allowed) {
      throw new HttpException(
        { status: 'rate_limited' },
        HttpStatus.TOO_MANY_REQUESTS,
        { description: `retry-after ${decisao.retryAfterSeconds}s` },
      );
    }
  }
}
