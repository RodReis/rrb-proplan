import {
  Body,
  Controller,
  HttpException,
  HttpStatus,
  Post,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { SlidingWindowRateLimiter } from '../../../shared/rate-limiter';
import {
  LicenseActivationService,
  type ActivateInput,
} from '../application/license-activation.service';
import { hashKey } from '../domain/license-key';

/**
 * 10 ativações por minuto **por IP**. Ativação legítima é rara — acontece uma
 * vez por máquina, e o retry do cliente é idempotente. O que este limite estreita
 * é a varredura de chaves a partir de um IP.
 */
const IP_LIMIT = 10;
/**
 * 5 por minuto **por chave**, e o teto menor é deliberado: uma chave legítima é
 * ativada em 2 máquinas (o `maxMachines` do piloto). Mais que isso na mesma
 * janela é chave compartilhada ou cliente em laço de retry.
 */
const KEY_LIMIT = 5;
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
  private readonly pruneTimer: NodeJS.Timeout;

  constructor(private readonly activation: LicenseActivationService) {
    this.pruneTimer = setInterval(() => {
      this.ipLimiter.prune();
      this.keyLimiter.prune();
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
   * Duas janelas independentes. A chave entra no limitador **hasheada**: o mapa
   * do limitador vive em memória e aparece em heap dump — guardar a chave em
   * claro ali desfaria, num despejo de memória, a decisão de nunca persistí-la.
   */
  private enforce(body: ActivateInput, req: Request): void {
    const ip = req.ip ?? req.socket?.remoteAddress ?? 'desconhecido';
    this.checar(this.ipLimiter, `ip:${ip}`);

    const key = typeof body?.key === 'string' ? body.key.trim() : '';
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
