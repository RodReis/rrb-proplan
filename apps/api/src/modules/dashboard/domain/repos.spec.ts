import { RateLimitError } from '../../board/domain/rate-limit';
import { MAX_REPOS_POR_CARGA, classificarFalha } from './repos';

describe('dashboard: salvaguardas do bloco de repos (SPEC-035 §2.11)', () => {
  describe('teto de repos por carga', () => {
    it('é 10 — decisão do PI, e existe para o F5 não virar 40 chamadas', () => {
      expect(MAX_REPOS_POR_CARGA).toBe(10);
    });
  });

  describe('classificação da falha — as três pedem texto diferente na tela', () => {
    it('rate limit preserva o horário de reposição', () => {
      const erro = new RateLimitError('2026-08-15T16:00:00.000Z');

      expect(classificarFalha(erro)).toEqual({
        reason: 'rate_limit',
        retryAt: '2026-08-15T16:00:00.000Z',
      });
    });

    it('timeout é `timeout`, pelo `name` do erro', () => {
      // `AbortSignal.timeout` rejeita com `TimeoutError`; o `name` é o contrato
      // estável, não a classe, que varia entre runtime e polyfill.
      const timeout = new Error('demorou');
      timeout.name = 'TimeoutError';
      const abort = new Error('abortado');
      abort.name = 'AbortError';

      expect(classificarFalha(timeout).reason).toBe('timeout');
      expect(classificarFalha(abort).reason).toBe('timeout');
    });

    it('qualquer outra coisa é `error`, sem horário prometido', () => {
      expect(classificarFalha(new Error('GitHub 500'))).toEqual({
        reason: 'error',
        retryAt: null,
      });
      expect(classificarFalha('string solta').reason).toBe('error');
      expect(classificarFalha(null).reason).toBe('error');
    });

    it('rate limit SEM horário continua sendo rate limit', () => {
      // O que não pode acontecer é virar `error` genérico: a mensagem de limite
      // atingido é o que impede a leitura de "zero issues".
      expect(classificarFalha(new RateLimitError(null))).toEqual({
        reason: 'rate_limit',
        retryAt: null,
      });
    });
  });
});
