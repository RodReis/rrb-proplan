import {
  Body,
  Controller,
  Get,
  Header,
  HttpException,
  HttpStatus,
  Param,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { SlidingWindowRateLimiter } from '../../../shared/rate-limiter';
import {
  GithubUnavailableError,
  GithubUserNotFoundError,
  SourceLinkInvalidError,
  SourceLinkService,
  SourceLinkUsedError,
} from '../application/source-link.service';

/**
 * 20 por minuto por par IP+token — mesmo teto do briefing e do contrato. O que
 * ele estreita é a varredura de tokens a partir de um IP, sem punir quem
 * legitimamente recarrega a própria página.
 */
const RATE_LIMIT = 20;
const RATE_WINDOW_MS = 60_000;
/**
 * 6 por minuto por IP na consulta de username, e o teto menor é deliberado: cada
 * chamada é uma requisição à API pública do GitHub feita **por nós**. Sem este
 * limite, o endpoint vira um proxy anônimo de consulta ao GitHub — e o rate limit
 * que estoura é o do nosso IP de servidor, derrubando a validação para todos os
 * compradores ao mesmo tempo.
 */
const LOOKUP_LIMIT = 6;
/** Poda o mapa a cada 5 min — ver `prune` no limitador. */
const PRUNE_INTERVAL_MS = 5 * 60_000;

/**
 * Rota PÚBLICA da coleta de username (SPEC-039 §Contratos) — **sem sessão**.
 *
 * Deliberadamente fora de `JwtAuthGuard`, `TenantGuard` e
 * `TenantContextInterceptor`: quem abre este link é o comprador do produto, que
 * **nunca terá conta no ProPlan**. O tenant é derivado do hash do token dentro do
 * service, via `resolve_source_link` (ADR-020), nunca de nada que venha no
 * request.
 *
 * ## Por que fora do `licensing/v1`
 *
 * O `/licensing/v1` é **contrato público e estável** consumido pelo binário do
 * War Room noutro repo (MVP4 §5). Esta rota é consumida pela nossa própria página
 * React e vai mudar quando a página mudar — pendurá-la no prefixo versionado
 * prometeria estabilidade que ela não tem, e obrigaria um `/v2` por causa de uma
 * mudança de tela.
 *
 * ## Os headers, e por que cada um
 *
 * - `Cache-Control: no-store` — a resposta é sobre um token de uso único. Cópia
 *   em proxy sobreviveria ao consumo do link, que é a mitigação principal.
 * - `X-Robots-Tag: noindex, nofollow` — a URL contém o token. Indexada, ela
 *   entrega acesso a código-fonte privado a quem buscar. A `<meta>` equivalente
 *   está na página React; os dois, porque o header cobre quem não executa HTML.
 */
@Controller('source-links')
export class SourceLinkPublicController {
  private readonly limiter = new SlidingWindowRateLimiter(RATE_LIMIT, RATE_WINDOW_MS);
  private readonly lookupLimiter = new SlidingWindowRateLimiter(
    LOOKUP_LIMIT,
    RATE_WINDOW_MS,
  );
  private readonly pruneTimer: NodeJS.Timeout;

  constructor(private readonly links: SourceLinkService) {
    this.pruneTimer = setInterval(() => {
      this.limiter.prune();
      this.lookupLimiter.prune();
    }, PRUNE_INTERVAL_MS);
    // `unref`: um timer ativo seguraria o processo vivo no shutdown e travaria
    // os testes que sobem o módulo.
    this.pruneTimer.unref();
  }

  /**
   * O link serve? Devolve **só produto e edição** (§Contratos).
   *
   * **200 em todos os estados, inclusive `invalid`.** O código de status é
   * observável por quem sonda, e um `404` distinguiria "não existe" de "existe e
   * já foi usado" — que é exatamente a diferença que o critério não-diferencial
   * proíbe expor. A página lê o `status` do corpo e decide o que mostrar.
   */
  @Get(':token')
  @Header('Cache-Control', 'no-store, no-cache, must-revalidate, private')
  @Header('X-Robots-Tag', 'noindex, nofollow')
  async read(@Param('token') token: string, @Req() req: Request, @Res() res: Response) {
    this.enforce(this.limiter, token, req, res);
    res.json(await this.links.resolvePublic(token));
  }

  /**
   * Consulta o login no GitHub, **sem gravar** — o passo da confirmação.
   *
   * `422` login inexistente ou sintaticamente inválido · `410` link já usado ·
   * `404` inválido · `429` rate limit · `503` GitHub indisponível.
   *
   * **`503` e `422` são desfechos diferentes de propósito.** Tratar rede fora
   * como "usuário não existe" faria o comprador corrigir um dado correto — ou
   * concluir que o próprio login está errado e desistir. É o precedente do FIX
   * #136: `429`/`5xx` não viram "link inválido".
   */
  @Post(':token/lookup')
  @Header('Cache-Control', 'no-store')
  @Header('X-Robots-Tag', 'noindex, nofollow')
  async lookup(
    @Param('token') token: string,
    @Body() body: { username?: string },
    @Req() req: Request,
    @Res() res: Response,
  ) {
    this.enforce(this.lookupLimiter, token, req, res);
    await this.responder(res, () =>
      this.links.lookupUsername(token, (body?.username ?? '').trim()),
    );
  }

  /**
   * Grava o username confirmado e **queima o link** (§Contratos).
   *
   * `200 { username }` · `422` login inexistente **ou `confirm` ausente** · `410`
   * já usado · `404` inválido · `429` rate limit · `503` GitHub indisponível.
   *
   * O `confirm` é exigido no servidor, não só na tela: um `POST` direto sem ele
   * pularia a confirmação por avatar, que é uma das três mitigações do risco
   * aceito (§Notas técnicas).
   */
  @Post(':token/username')
  @Header('Cache-Control', 'no-store')
  @Header('X-Robots-Tag', 'noindex, nofollow')
  async setUsername(
    @Param('token') token: string,
    @Body() body: { username?: string; confirm?: boolean },
    @Req() req: Request,
    @Res() res: Response,
  ) {
    this.enforce(this.limiter, token, req, res);
    await this.responder(res, () =>
      this.links.setUsername(token, (body?.username ?? '').trim(), body?.confirm === true),
    );
  }

  /**
   * Traduz os erros do service em status HTTP. O service não conhece HTTP — é o
   * que permite testá-lo sem subir o Nest.
   */
  private async responder<T>(res: Response, acao: () => Promise<T>): Promise<void> {
    try {
      res.json(await acao());
    } catch (erro) {
      if (erro instanceof SourceLinkUsedError) {
        throw new HttpException({ status: 'used' }, HttpStatus.GONE);
      }
      if (erro instanceof SourceLinkInvalidError) {
        throw new HttpException({ status: 'invalid' }, HttpStatus.NOT_FOUND);
      }
      if (erro instanceof GithubUserNotFoundError) {
        // A mensagem **nomeia o que foi procurado** (critério de aceite): sem o
        // login na resposta, o comprador não sabe se errou a digitação ou se o
        // sistema não entendeu o envio.
        throw new HttpException(
          { status: 'user_not_found', username: erro.message },
          HttpStatus.UNPROCESSABLE_ENTITY,
        );
      }
      if (erro instanceof GithubUnavailableError) {
        throw new HttpException(
          { status: 'github_unavailable' },
          HttpStatus.SERVICE_UNAVAILABLE,
        );
      }
      throw erro;
    }
  }

  /**
   * Chave IP+token, com o `Retry-After` escrito no **header** antes do throw: o
   * `description` da `HttpException` não vira header, então o campo simplesmente
   * não chegaria a quem foi barrado.
   */
  private enforce(
    limiter: SlidingWindowRateLimiter,
    token: string,
    req: Request,
    res: Response,
  ) {
    const ip = req.ip ?? req.socket?.remoteAddress ?? 'desconhecido';
    const decision = limiter.check(`${ip}:${token}`);

    if (decision.allowed) return;

    res.setHeader('Retry-After', String(decision.retryAfterSeconds));

    const erro = new HttpException(
      { status: 'rate_limited', retryAfterSeconds: decision.retryAfterSeconds },
      HttpStatus.TOO_MANY_REQUESTS,
    );
    Object.assign(erro, { retryAfterSeconds: decision.retryAfterSeconds });
    throw erro;
  }
}
