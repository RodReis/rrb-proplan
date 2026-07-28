import {
  CONTRACT_LINK_TTL_MS,
  contractLinkStatus,
  defaultExpiration,
  generateToken,
  hashToken,
} from './contract-token';

describe('SPEC-034: token do link de contrato', () => {
  it('gera token com 256 bits de entropia, seguro em URL', () => {
    const token = generateToken();
    // base64url de 32 bytes: 43 caracteres, sem `+`, `/` ou `=`.
    expect(token).toHaveLength(43);
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('não repete token entre chamadas', () => {
    const tokens = new Set(Array.from({ length: 50 }, () => generateToken()));
    expect(tokens.size).toBe(50);
  });

  it('o hash é SHA-256 hex e é estável para o mesmo token', () => {
    const hash = hashToken('token-fixo');
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hashToken('token-fixo')).toBe(hash);
  });

  it('tokens diferentes produzem hashes diferentes', () => {
    expect(hashToken('a')).not.toBe(hashToken('b'));
  });
});

describe('SPEC-034: estado do link de contrato', () => {
  const agora = new Date('2026-07-28T12:00:00Z');

  it('link não encontrado é `invalid` — mesma resposta de token alheio (§5)', () => {
    expect(contractLinkStatus(null, agora)).toBe('invalid');
  });

  it('link dentro do prazo e não revogado é `valid`', () => {
    const status = contractLinkStatus(
      { expiresAt: new Date('2026-07-29T12:00:00Z'), revokedAt: null },
      agora,
    );
    expect(status).toBe('valid');
  });

  it('link vencido é `expired`', () => {
    const status = contractLinkStatus(
      { expiresAt: new Date('2026-07-28T11:59:59Z'), revokedAt: null },
      agora,
    );
    expect(status).toBe('expired');
  });

  it('revogado vence expirado — revogar é ato deliberado do prestador', () => {
    const status = contractLinkStatus(
      {
        expiresAt: new Date('2026-07-27T12:00:00Z'),
        revokedAt: new Date('2026-07-28T10:00:00Z'),
      },
      agora,
    );
    expect(status).toBe('revoked');
  });

  it('o instante exato da expiração já conta como vencido', () => {
    const status = contractLinkStatus(
      { expiresAt: agora, revokedAt: null },
      agora,
    );
    expect(status).toBe('expired');
  });
});

describe('SPEC-034: expiração padrão de 48 h (§2.8)', () => {
  it('a constante é 48 h, não os 7 dias do briefing', () => {
    expect(CONTRACT_LINK_TTL_MS).toBe(48 * 60 * 60 * 1000);
  });

  /**
   * O link expõe CPF/CNPJ e endereço das DUAS partes. Um prazo mais longo aqui
   * não é conveniência, é dado pessoal legível por mais tempo por quem tiver a
   * URL — a decisão 6 do PI fixou 48 h e a regeneração é livre.
   */
  it('a expiração padrão cai 48 h à frente do instante dado', () => {
    const base = new Date('2026-07-28T12:00:00Z');
    expect(defaultExpiration(base).toISOString()).toBe(
      '2026-07-30T12:00:00.000Z',
    );
  });

  it('nunca devolve nulo — não existe link de contrato sem prazo', () => {
    expect(defaultExpiration()).toBeInstanceOf(Date);
  });
});
