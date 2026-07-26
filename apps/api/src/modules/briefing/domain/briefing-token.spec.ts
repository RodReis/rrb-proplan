import {
  generateToken,
  hashToken,
  linkStatus,
  tokenHashEquals,
} from './briefing-token';

describe('token do link de briefing (SPEC-029)', () => {
  describe('geração', () => {
    it('tem 256 bits de entropia e é seguro em URL', () => {
      const token = generateToken();
      // base64url de 32 bytes → 43 chars, sem padding.
      expect(Buffer.from(token, 'base64url')).toHaveLength(32);
      // Nada que precise de escape em URL (sem +, / ou =).
      expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
    });

    it('nunca repete', () => {
      const tokens = new Set(Array.from({ length: 500 }, () => generateToken()));
      expect(tokens.size).toBe(500);
    });
  });

  describe('hash', () => {
    it('é determinístico — é o que permite o lookup por hash', () => {
      const token = generateToken();
      expect(hashToken(token)).toBe(hashToken(token));
    });

    it('tokens diferentes geram hashes diferentes', () => {
      expect(hashToken(generateToken())).not.toBe(hashToken(generateToken()));
    });

    it('o hash NÃO contém o token — é o critério de aceite da spec', () => {
      const token = generateToken();
      const hash = hashToken(token);
      expect(hash).not.toContain(token);
      expect(hash).toHaveLength(64); // sha256 em hex
      // E não é reversível por decode trivial.
      expect(Buffer.from(hash, 'hex').toString('base64url')).not.toBe(token);
    });
  });

  describe('comparação em tempo constante', () => {
    it('reconhece hashes iguais e recusa diferentes', () => {
      const hash = hashToken('abc');
      expect(tokenHashEquals(hash, hash)).toBe(true);
      expect(tokenHashEquals(hash, hashToken('abd'))).toBe(false);
    });

    it('comprimento diferente sai por false, sem estourar', () => {
      // timingSafeEqual lança se os buffers diferem em tamanho — a guarda de
      // comprimento existe para isso, e não vaza nada além do comprimento (que
      // é fixo para sha256 hex).
      expect(tokenHashEquals('curto', hashToken('abc'))).toBe(false);
      expect(tokenHashEquals('', '')).toBe(true);
    });
  });

  describe('ciclo de vida', () => {
    const now = new Date('2026-07-25T12:00:00Z');

    it('link novo é válido', () => {
      expect(linkStatus({}, now)).toBe('valid');
      expect(linkStatus({ expiresAt: null, revokedAt: null }, now)).toBe('valid');
    });

    it('link inexistente é inválido (não-diferencial: igual a alheio)', () => {
      expect(linkStatus(null, now)).toBe('invalid');
    });

    it('expiração no passado → expired; no futuro → valid', () => {
      expect(linkStatus({ expiresAt: new Date('2026-07-24T12:00:00Z') }, now)).toBe(
        'expired',
      );
      expect(linkStatus({ expiresAt: new Date('2026-07-26T12:00:00Z') }, now)).toBe(
        'valid',
      );
    });

    it('expiração exatamente agora já conta como expirada', () => {
      // Limite fechado: `<=`. Um link "válido até 12:00" não vale às 12:00.
      expect(linkStatus({ expiresAt: new Date(now) }, now)).toBe('expired');
    });

    it('revogado vence expirado', () => {
      // Revogar é ato deliberado do prestador; um link revogado que também
      // expirou continua sendo, antes de tudo, revogado.
      const status = linkStatus(
        {
          revokedAt: new Date('2026-07-20T12:00:00Z'),
          expiresAt: new Date('2026-07-24T12:00:00Z'),
        },
        now,
      );
      expect(status).toBe('revoked');
    });
  });
});
