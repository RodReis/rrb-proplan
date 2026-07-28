/**
 * Rate limit das rotas públicas sem sessão: `GET /b/:token` (SPEC-029) e
 * `GET /c/:token` (SPEC-034).
 *
 * Mora em `shared/` e não no `briefing/` porque passou a ter dois donos. Mover
 * foi preferido a duplicar: a alternativa era uma segunda cópia do mesmo
 * limitador dentro do `contracts` — que a fronteira entre módulos exigiria, já
 * que um módulo não importa entidade interna do outro.
 *
 * Janela deslizante por chave (IP + token), em memória. Sem dependência nova:
 * o `@nestjs/throttler` não está instalado, e o que a spec pede — barrar
 * varredura de token numa rota sem sessão — cabe em ~30 linhas.
 *
 * ponytail: contador em memória, por processo. Com N réplicas da API, o limite
 * efetivo vira N×LIMIT. Aceitável aqui: o alvo é enumeração de token, e mesmo
 * N×20/min é irrelevante contra 256 bits de entropia. Se virar problema real
 * (ou se a contagem precisar ser exata para billing/abuso), promover para o
 * Redis que já existe no stack — a interface não muda.
 */

export interface RateLimitDecision {
  allowed: boolean;
  /** Segundos até a janela liberar — vira `Retry-After` no 429. */
  retryAfterSeconds: number;
}

export class SlidingWindowRateLimiter {
  private readonly hits = new Map<string, number[]>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
  ) {}

  check(key: string, now: number = Date.now()): RateLimitDecision {
    const cutoff = now - this.windowMs;
    // Só os hits dentro da janela: a poda acontece na leitura, então não há
    // timer nem varredura periódica para manter.
    const recent = (this.hits.get(key) ?? []).filter((t) => t > cutoff);

    if (recent.length >= this.limit) {
      this.hits.set(key, recent);
      const oldest = recent[0];
      return {
        allowed: false,
        retryAfterSeconds: Math.max(
          1,
          Math.ceil((oldest + this.windowMs - now) / 1000),
        ),
      };
    }

    recent.push(now);
    this.hits.set(key, recent);
    return { allowed: true, retryAfterSeconds: 0 };
  }

  /**
   * Descarta chaves cujos hits saíram todos da janela. Sem isto o Map cresce
   * para sempre num processo longo — cada IP novo deixaria uma entrada órfã.
   */
  prune(now: number = Date.now()): void {
    const cutoff = now - this.windowMs;
    for (const [key, times] of this.hits) {
      if (times.every((t) => t <= cutoff)) this.hits.delete(key);
    }
  }

  /** Só para teste: quantas chaves estão vivas. */
  get size(): number {
    return this.hits.size;
  }
}
