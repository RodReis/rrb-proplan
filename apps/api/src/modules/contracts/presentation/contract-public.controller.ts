import {
  Controller,
  Get,
  Header,
  HttpException,
  HttpStatus,
  Param,
  Req,
  Res,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { SlidingWindowRateLimiter } from '../../../shared/rate-limiter';
import { ContractLinkService } from '../application/contract-link.service';
import { renderPublicPage } from '../domain/public-page';

/** 20 requisições por minuto, por par IP+token — mesmo teto do briefing. */
const RATE_LIMIT = 20;
const RATE_WINDOW_MS = 60_000;
/** Poda o mapa a cada 5 min — ver `prune` no limitador. */
const PRUNE_INTERVAL_MS = 5 * 60_000;

/**
 * Rota PÚBLICA do contrato (SPEC-034 §2.7) — **sem sessão**.
 *
 * Deliberadamente fora de `JwtAuthGuard`, `TenantGuard` e
 * `TenantContextInterceptor`: quem abre este link é o cliente do prestador, que
 * não tem conta no ProPlan. O tenant é derivado do **hash do token** dentro do
 * service, via `resolve_contract_link` (ADR-020), nunca de nada que venha no
 * request.
 *
 * ## Só GET, e isso é a decisão
 *
 * O briefing público tem `PATCH` e `POST` porque o cliente **preenche** algo
 * lá. Aqui ele só **lê**: não há aceite pela rota pública (§2.7), então não há
 * verbo de escrita a limitar — e nenhum a esquecer de limitar. Há teste
 * afirmando que este controller não expõe escrita.
 *
 * ## Os três headers, e por que cada um
 *
 * - `Cache-Control: no-store` + `Pragma: no-cache` — o documento traz CPF/CNPJ e
 *   endereço das duas partes. Uma cópia em proxy, browser ou CDN sobreviveria à
 *   revogação e à expiração de 48 h, que são as duas mitigações da decisão 8.1.
 * - `X-Robots-Tag: noindex, nofollow` — mais a `<meta name="robots">` no HTML.
 *   Os dois, porque o header cobre quem não executa HTML e a meta cobre quem
 *   chega ao documento por outro caminho.
 */
@Controller('c')
export class ContractPublicController {
  private readonly limiter = new SlidingWindowRateLimiter(
    RATE_LIMIT,
    RATE_WINDOW_MS,
  );
  private readonly pruneTimer: NodeJS.Timeout;

  constructor(private readonly links: ContractLinkService) {
    this.pruneTimer = setInterval(
      () => this.limiter.prune(),
      PRUNE_INTERVAL_MS,
    );
    // `unref`: um timer ativo seguraria o processo vivo no shutdown e travaria
    // os testes que sobem o módulo.
    this.pruneTimer.unref();
  }

  /**
   * O contrato, como página. Devolve HTML — não JSON: quem abre é uma pessoa no
   * browser, e o §2.9 diz que a impressão é o `Ctrl+P` dela.
   *
   * Estado que não serve devolve **200 com a página de recado**, não 404: o
   * código de status é observável por quem sonda, e um 404 distinguiria
   * "inexistente" de "revogado" — que é exatamente a diferença que o critério
   * não-diferencial (§5) proíbe expor.
   */
  @Get(':token')
  @Header('Cache-Control', 'no-store, no-cache, must-revalidate, private')
  @Header('Pragma', 'no-cache')
  @Header('X-Robots-Tag', 'noindex, nofollow')
  @Header('Content-Type', 'text/html; charset=utf-8')
  async read(
    @Param('token') token: string,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    this.enforce(token, req, res);

    const resolvido = await this.links.resolvePublic(token);
    res.send(renderPublicPage(resolvido));
  }

  /**
   * Chave IP+token: limita a varredura de tokens a partir de um IP sem punir
   * quem legitimamente recarrega o próprio contrato.
   *
   * O `Retry-After` vai no **header**, escrito na resposta antes do throw. O
   * `description` da `HttpException` NÃO vira header — vira `cause`, que morre
   * no servidor —, então o campo que o §5 exige simplesmente não chegaria a
   * quem foi barrado. O `retryAfterSeconds` também viaja na exceção para que o
   * teste possa afirmá-lo sem depender do transporte.
   */
  private enforce(token: string, req: Request, res: Response) {
    const ip = req.ip ?? req.socket?.remoteAddress ?? 'desconhecido';
    const decision = this.limiter.check(`${ip}:${token}`);

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
