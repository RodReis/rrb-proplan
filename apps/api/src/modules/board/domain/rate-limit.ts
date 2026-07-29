/**
 * Rate limit do GitHub, reconhecível pelo chamador.
 *
 * Mora no `board` porque é aqui que a conversa com o GitHub acontece — o
 * `GithubIssuesClient` é quem vê os headers. Quem consome (o dashboard, §2.11)
 * precisa distinguir *"limite atingido, volta às HH:MM"* de falha comum, e com
 * `Error('GitHub 403')` não há como: a tela cairia no texto genérico e um
 * bloco vazio leria como **board vazio**, que é a leitura errada mais cara
 * desta tela.
 */
export class RateLimitError extends Error {
  constructor(readonly retryAt: string | null) {
    super('rate limit do GitHub atingido');
    this.name = 'RateLimitError';
  }
}

/**
 * A resposta é um rate limit?
 *
 * Duas formas, e as duas importam: **`403` com `x-ratelimit-remaining: 0`**
 * (limite primário) e **`429`** (secundário/abuso).
 *
 * `403` com cota **sobrando** é outra coisa — falta de permissão. Chamá-lo de
 * rate limit mandaria a pessoa esperar por algo que não passa sozinho com o
 * tempo.
 */
export function ehRateLimit(status: number, headers: Headers): boolean {
  if (status === 429) return true;
  return status === 403 && headers.get('x-ratelimit-remaining') === '0';
}

/**
 * Quando o limite volta, a partir dos headers.
 *
 * `x-ratelimit-reset` é epoch em segundos (limite primário) e ganha do
 * `retry-after`, que é relativo (secundário). Sem nenhum dos dois, `null` — e a
 * tela diz que o limite foi atingido **sem inventar horário**: um horário falso
 * é pior que a ausência dele, porque a pessoa volta, falha de novo, e passa a
 * desconfiar da mensagem inteira.
 */
export function lerRetryAt(headers: Headers, agora: Date): string | null {
  const reset = headers.get('x-ratelimit-reset');
  if (reset) {
    const epoch = Number(reset);
    if (Number.isFinite(epoch) && epoch > 0) return new Date(epoch * 1000).toISOString();
  }
  const retryAfter = headers.get('retry-after');
  if (retryAfter) {
    const segundos = Number(retryAfter);
    if (Number.isFinite(segundos) && segundos >= 0) {
      return new Date(agora.getTime() + segundos * 1000).toISOString();
    }
  }
  return null;
}
