import {
  Body,
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Param,
  Patch,
  Req,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { Request } from 'express';
import { BriefingDraftService } from '../application/briefing-draft.service';
import { SlidingWindowRateLimiter } from '../domain/rate-limiter';

/** 20 requisições por minuto, por par IP+token. */
const RATE_LIMIT = 20;
const RATE_WINDOW_MS = 60_000;
/**
 * Escrita tem teto próprio e menor: o save automático dispara a cada 30 s de
 * inatividade (spec §2), então o uso legítimo é raro. 10/min cobre digitação
 * rápida com folga e ainda estreita a janela de abuso.
 */
const WRITE_RATE_LIMIT = 10;
/** Poda o mapa a cada 5 min — ver `prune` no limitador. */
const PRUNE_INTERVAL_MS = 5 * 60_000;

interface SaveDraftBody {
  step?: unknown;
  answers?: unknown;
}

/**
 * Rota PÚBLICA do briefing (SPEC-029 + SPEC-031) — **sem sessão**.
 *
 * Deliberadamente fora de `JwtAuthGuard`, `TenantGuard` e
 * `TenantContextInterceptor`: quem abre este link é o cliente do prestador, que
 * não tem conta no ProPlan. O tenant é derivado do **hash do token** dentro do
 * service (ADR-020), nunca de nada que venha no request.
 *
 * Não-diferencial: token inexistente e token de outro tenant devolvem a mesma
 * resposta. Nenhum dos estados vaza tenant, cliente ou projeto.
 *
 * **Rate limit em toda rota, inclusive escrita** (critério de aceite da
 * SPEC-031): limitar só o GET deixaria o `PATCH` como a porta larga.
 */
@Controller('b')
export class BriefingPublicController {
  private readonly limiter = new SlidingWindowRateLimiter(
    RATE_LIMIT,
    RATE_WINDOW_MS,
  );
  private readonly writeLimiter = new SlidingWindowRateLimiter(
    WRITE_RATE_LIMIT,
    RATE_WINDOW_MS,
  );
  private readonly pruneTimer: NodeJS.Timeout;

  constructor(private readonly drafts: BriefingDraftService) {
    this.pruneTimer = setInterval(() => {
      this.limiter.prune();
      this.writeLimiter.prune();
    }, PRUNE_INTERVAL_MS);
    // `unref`: um timer ativo seguraria o processo vivo no shutdown e travaria
    // os testes que sobem o módulo.
    this.pruneTimer.unref();
  }

  /**
   * Estado do link + rascunho. Estende a rota da SPEC-029: onde ela respondia
   * só `{ status }`, esta devolve também onde retomar e o que já foi
   * respondido — mas **apenas** quando o link está válido.
   */
  @Get(':token')
  async resolve(@Param('token') token: string, @Req() req: Request) {
    this.enforce(this.limiter, token, req);
    return this.drafts.getPublicState(token);
  }

  /** Salva uma etapa do rascunho. O 1º save move o card no funil. */
  @Patch(':token/draft')
  async saveDraft(
    @Param('token') token: string,
    @Body() body: SaveDraftBody,
    @Req() req: Request,
  ) {
    this.enforce(this.writeLimiter, token, req);

    // O controller só garante o FORMATO; o conteúdo é validado no domain. Sem
    // esta checagem um `step` string chegaria ao service como NaN.
    const step = Number(body?.step);
    if (!Number.isFinite(step)) {
      throw new UnprocessableEntityException('`step` numérico é obrigatório');
    }

    const answers = body?.answers;
    if (answers === null || typeof answers !== 'object' || Array.isArray(answers)) {
      throw new UnprocessableEntityException('`answers` deve ser um objeto');
    }

    return this.drafts.saveDraft(token, step, answers as Record<string, unknown>);
  }

  /**
   * Chave IP+token: limita a varredura de tokens a partir de um IP sem punir
   * quem legitimamente recarrega ou salva o próprio rascunho.
   */
  private enforce(
    limiter: SlidingWindowRateLimiter,
    token: string,
    req: Request,
  ) {
    const ip = req.ip ?? req.socket?.remoteAddress ?? 'desconhecido';
    const decision = limiter.check(`${ip}:${token}`);

    if (!decision.allowed) {
      throw new HttpException(
        { status: 'rate_limited' },
        HttpStatus.TOO_MANY_REQUESTS,
        { description: `retry-after ${decision.retryAfterSeconds}s` },
      );
    }
  }
}
