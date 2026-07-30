import {
  generateToken,
  hashToken,
  isValidGithubUsername,
  sourceLinkStatus,
} from './source-token';

/**
 * O token e o estado do link (SPEC-039). Funções puras — o teste é barato e a
 * regressão que ele pega é caríssima: este token concede acesso a código-fonte
 * privado.
 */

describe('token do link de coleta', () => {
  it('tem 256 bits de entropia e é seguro em URL', () => {
    const token = generateToken();

    // 32 bytes em base64url = 43 caracteres. Um token mais curto reduziria a
    // entropia sem que nada falhasse — e força-bruta contra um endpoint que
    // concede acesso a código-fonte é a única coisa que a entropia impede.
    expect(token).toHaveLength(43);
    // base64url: sem `+`, `/` ou `=`, que precisariam de escape na URL e
    // chegariam corrompidos ao servidor.
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('não repete', () => {
    const tokens = new Set(Array.from({ length: 200 }, () => generateToken()));
    expect(tokens.size).toBe(200);
  });

  it('o hash é estável e não é o token', () => {
    const token = generateToken();

    expect(hashToken(token)).toBe(hashToken(token));
    expect(hashToken(token)).toHaveLength(64);
    // O que persiste não pode ser o que abre o link: vazamento do banco não
    // entrega link ativo.
    expect(hashToken(token)).not.toBe(token);
  });

  it('hashes diferentes para tokens diferentes', () => {
    expect(hashToken('a')).not.toBe(hashToken('b'));
  });
});

describe('estado do link', () => {
  it('sem `usedAt` é válido', () => {
    expect(sourceLinkStatus({ usedAt: null })).toBe('valid');
  });

  it('com `usedAt` é `used`, não `invalid`', () => {
    // O critério de aceite depende desta distinção: reabrir o próprio link
    // mostra "já utilizado", nunca o formulário de novo. Se `used` virasse
    // `invalid`, quem informou o username e recarregou concluiria que o envio
    // não funcionou — e informaria de novo.
    expect(sourceLinkStatus({ usedAt: new Date() })).toBe('used');
  });

  it('link não encontrado é `invalid`', () => {
    // Inexistente e de outro tenant chegam aqui os dois como `null`, porque a
    // `resolve_source_link` não encontra nenhum dos dois. É o critério
    // não-diferencial preservado onde ele protege: na enumeração de tokens.
    expect(sourceLinkStatus(null)).toBe('invalid');
  });

  it('não existe estado `expired`', () => {
    // Decisão PI #3: o link não tem prazo. Um `expired` aqui seria o primeiro
    // sinal de que alguém reintroduziu TTL — e o beco do comprador que responde
    // tarde voltaria com ele.
    const estados = [
      sourceLinkStatus(null),
      sourceLinkStatus({ usedAt: null }),
      sourceLinkStatus({ usedAt: new Date() }),
    ];
    expect(estados).not.toContain('expired');
  });
});

describe('sintaxe do username do GitHub', () => {
  it.each(['RodReis', 'a', 'user-name', 'x1', 'a'.repeat(39)])(
    'aceita `%s`',
    (username) => {
      expect(isValidGithubUsername(username)).toBe(true);
    },
  );

  it.each([
    ['', 'vazio'],
    ['-user', 'começa com hífen'],
    ['user-', 'termina com hífen'],
    ['us--er', 'hífen duplo'],
    ['a'.repeat(40), 'passa de 39 caracteres'],
    ['user name', 'espaço'],
    ['user_name', 'underscore não é permitido pelo GitHub'],
    ['user@host', 'arroba'],
  ])('recusa `%s` (%s)', (username) => {
    expect(isValidGithubUsername(username)).toBe(false);
  });

  it.each([
    '../../admin',
    'user/../other',
    'user?tab=repositories',
    'user#fragment',
    'user%2F',
  ])('recusa `%s` — não pode virar caminho na URL da API', (username) => {
    // Esta é a razão de validar sintaxe ANTES da chamada de rede. Sem isso, o
    // valor é interpolado em `GET /users/:username` e a requisição sai para
    // outro endpoint da API do GitHub — com o PAT do tenant no header.
    expect(isValidGithubUsername(username)).toBe(false);
  });

  it('validar sintaxe não é validar existência', () => {
    // `zzz-nao-existe-jamais` é sintaticamente perfeito e não existe no GitHub.
    // A distinção importa porque a spec pede as duas checagens, e passar só por
    // esta gravaria um username que nunca receberá convite — o comprador
    // esperaria para sempre, sem erro em lugar nenhum.
    expect(isValidGithubUsername('zzz-nao-existe-jamais')).toBe(true);
  });
});
