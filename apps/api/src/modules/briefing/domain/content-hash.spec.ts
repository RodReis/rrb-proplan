import { canonicalJson, contentHashOf } from './content-hash';

/**
 * A chave da idempotência do submit (SPEC-031 §5).
 *
 * O teste que importa não é "hash funciona" — é **conteúdo igual, hash igual,
 * independente do caminho**. As respostas chegam etapa por etapa e são
 * reescritas a cada save, então a ordem de inserção das chaves varia conforme a
 * pessoa preenche, volta e corrige. Se o hash mudasse com a ordem, o duplo
 * clique voltaria a criar duas versões — e ninguém descobriria até aparecerem
 * dois cards iguais no funil.
 */

describe('canonicalJson', () => {
  it('ordena chaves de objeto, então a ordem de inserção não conta', () => {
    const a = { b: 1, a: 2 };
    const b = { a: 2, b: 1 };
    expect(canonicalJson(a)).toBe(canonicalJson(b));
  });

  it('ordena em profundidade, não só no primeiro nível', () => {
    const a = { '1': { company: 'X', segment: 'Y' } };
    const b = { '1': { segment: 'Y', company: 'X' } };
    expect(canonicalJson(a)).toBe(canonicalJson(b));
  });

  it('NÃO ordena arrays — a ordem que o cliente digitou é resposta dele', () => {
    // Listar "cadastro, relatório" é diferente de "relatório, cadastro" para
    // quem lê o briefing depois. Ordenar apagaria a prioridade implícita.
    expect(canonicalJson(['a', 'b'])).not.toBe(canonicalJson(['b', 'a']));
  });

  it('distingue valores diferentes na mesma chave', () => {
    expect(canonicalJson({ a: 1 })).not.toBe(canonicalJson({ a: 2 }));
  });

  it('trata null e escalares como JSON normal', () => {
    expect(canonicalJson(null)).toBe('null');
    expect(canonicalJson(42)).toBe('42');
    expect(canonicalJson('x')).toBe('"x"');
    expect(canonicalJson(true)).toBe('true');
  });

  it('descarta `undefined` (ausência é informação, não string vazia)', () => {
    expect(canonicalJson({ a: 1, b: undefined })).toBe('{"a":1}');
  });

  it('produz JSON válido e reparseável', () => {
    const value = { '2': { problem: 'p' }, '1': { company: 'c', tags: ['x'] } };
    expect(() => JSON.parse(canonicalJson(value))).not.toThrow();
    expect(JSON.parse(canonicalJson(value))).toEqual(value);
  });
});

describe('contentHashOf', () => {
  it('mesmo conteúdo em ordem diferente ⇒ MESMO hash (a idempotência)', () => {
    // O cenário real: preencheu a etapa 1, foi para a 2, voltou e corrigiu a 1.
    const caminhoA = {
      1: { company: 'EPG', segment: 'educacao' },
      2: { problem: 'p', expected: 'e' },
    };
    const caminhoB = {
      2: { expected: 'e', problem: 'p' },
      1: { segment: 'educacao', company: 'EPG' },
    };

    expect(contentHashOf(caminhoA)).toBe(contentHashOf(caminhoB));
  });

  it('conteúdo diferente ⇒ hash diferente', () => {
    expect(contentHashOf({ 1: { company: 'A' } })).not.toBe(
      contentHashOf({ 1: { company: 'B' } }),
    );
  });

  it('um campo a mais muda o hash', () => {
    expect(contentHashOf({ 1: { company: 'A' } })).not.toBe(
      contentHashOf({ 1: { company: 'A', segment: 'x' } }),
    );
  });

  it('é estável entre chamadas (não usa relógio nem aleatório)', () => {
    const answers = { 1: { company: 'EPG' } };
    expect(contentHashOf(answers)).toBe(contentHashOf(answers));
  });

  it('devolve hex de SHA-256 (64 caracteres)', () => {
    expect(contentHashOf({ 1: { company: 'X' } })).toMatch(/^[0-9a-f]{64}$/);
  });
});
