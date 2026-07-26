import {
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Param,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { BriefingLinkService } from '../application/briefing-link.service';
import { SlidingWindowRateLimiter } from '../domain/rate-limiter';

/** 20 requisições por minuto, por par IP+token. */
const RATE_LIMIT = 20;
const RATE_WINDOW_MS = 60_000;
/** Poda o mapa a cada 5 min — ver `prune` no limitador. */
const PRUNE_INTERVAL_MS = 5 * 60_000;

/**
 * Rota PÚBLICA do link de briefing (SPEC-029) — **sem sessão**.
 *
 * Deliberadamente fora de `JwtAuthGuard`, `TenantGuard` e
 * `TenantContextInterceptor`: quem abre este link é o cliente do prestador, que
 * não tem conta no ProPlan. O tenant é derivado do **hash do token** dentro do
 * service (ADR-020), nunca de nada que venha no request.
 *
 * Não-diferencial: token inexistente e token de outro tenant devolvem a mesma
 * resposta. Nenhum dos estados vaza tenant, cliente ou projeto.
 *
 * Nesta fatia a rota responde só o **estado** do link; o formulário de briefing
 * em si é a fatia seguinte.
 */
@Controller('b')
export class BriefingPublicController {
  private readonly limiter = new SlidingWindowRateLimiter(
    RATE_LIMIT,
    RATE_WINDOW_MS,
  );
  private readonly pruneTimer: NodeJS.Timeout;

  constructor(private readonly links: BriefingLinkService) {
    this.pruneTimer = setInterval(
      () => this.limiter.prune(),
      PRUNE_INTERVAL_MS,
    );
    // `unref`: um timer ativo seguraria o processo vivo no shutdown e travaria
    // os testes que sobem o módulo.
    this.pruneTimer.unref();
  }

  @Get(':token')
  async resolve(@Param('token') token: string, @Req() req: Request) {
    // Chave IP+token: limita a varredura de tokens a partir de um IP sem punir
    // quem legitimamente recarrega o próprio link.
    const ip = req.ip ?? req.socket?.remoteAddress ?? 'desconhecido';
    const decision = this.limiter.check(`${ip}:${token}`);

    if (!decision.allowed) {
      throw new HttpException(
        { status: 'rate_limited' },
        HttpStatus.TOO_MANY_REQUESTS,
        { description: `retry-after ${decision.retryAfterSeconds}s` },
      );
    }

    return this.links.resolvePublic(token);
  }
}
