import { ehRateLimit, lerRetryAt } from './rate-limit';

const AGORA = new Date('2026-08-15T15:00:00.000Z');

function headers(pares: Record<string, string>): Headers {
  return new Headers(pares);
}

/**
 * O rate limit do GitHub precisa ser **reconhecível**, e não `Error` genérico
 * (SPEC-035 §2.11): o bloco de repos do dashboard tem de dizer *"o limite foi
 * atingido e volta às HH:MM"* em vez de mostrar zero — que seria indistinguível
 * de board vazio.
 */
describe('board: rate limit do GitHub', () => {
  describe('o que é rate limit e o que não é', () => {
    it('429 é rate limit (secundário/abuso)', () => {
      expect(ehRateLimit(429, headers({}))).toBe(true);
    });

    it('403 com cota ZERADA é rate limit (primário)', () => {
      expect(ehRateLimit(403, headers({ 'x-ratelimit-remaining': '0' }))).toBe(true);
    });

    it('403 com cota SOBRANDO NÃO é rate limit — é permissão', () => {
      // Chamá-lo de rate limit mandaria a pessoa esperar por algo que não passa
      // sozinho com o tempo.
      expect(ehRateLimit(403, headers({ 'x-ratelimit-remaining': '4321' }))).toBe(false);
      expect(ehRateLimit(403, headers({}))).toBe(false);
    });

    it('404 e 500 não são rate limit', () => {
      expect(ehRateLimit(404, headers({ 'x-ratelimit-remaining': '0' }))).toBe(false);
      expect(ehRateLimit(500, headers({}))).toBe(false);
    });
  });

  describe('quando o limite volta', () => {
    it('lê `x-ratelimit-reset` (epoch em segundos)', () => {
      const epoch = Math.floor(new Date('2026-08-15T16:00:00.000Z').getTime() / 1000);

      expect(lerRetryAt(headers({ 'x-ratelimit-reset': String(epoch) }), AGORA)).toBe(
        '2026-08-15T16:00:00.000Z',
      );
    });

    it('lê `retry-after` (segundos a partir de agora) quando não há reset', () => {
      expect(lerRetryAt(headers({ 'retry-after': '60' }), AGORA)).toBe(
        '2026-08-15T15:01:00.000Z',
      );
    });

    it('`x-ratelimit-reset` ganha do `retry-after` — é o horário absoluto', () => {
      const epoch = Math.floor(new Date('2026-08-15T16:00:00.000Z').getTime() / 1000);

      expect(
        lerRetryAt(
          headers({ 'x-ratelimit-reset': String(epoch), 'retry-after': '60' }),
          AGORA,
        ),
      ).toBe('2026-08-15T16:00:00.000Z');
    });

    it('sem header nenhum devolve `null` — NÃO inventa horário', () => {
      // Horário falso é pior que a ausência dele: a pessoa volta, falha de novo,
      // e passa a desconfiar da mensagem inteira.
      expect(lerRetryAt(headers({}), AGORA)).toBeNull();
    });

    it('valor ilegível não vira data maluca', () => {
      expect(lerRetryAt(headers({ 'x-ratelimit-reset': 'agora' }), AGORA)).toBeNull();
      expect(lerRetryAt(headers({ 'retry-after': 'depois' }), AGORA)).toBeNull();
      expect(lerRetryAt(headers({ 'x-ratelimit-reset': '0' }), AGORA)).toBeNull();
    });
  });
});
