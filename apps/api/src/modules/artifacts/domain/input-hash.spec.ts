import { inputHashOf, type ArtifactInput } from './input-hash';

const base: ArtifactInput = {
  kind: 'scope',
  promptVersion: 'v1',
  answers: { 1: { produto: 'site' }, 2: { prazo: '30d' } },
};

describe('inputHashOf: serialização canônica (SPEC-032 §2.8)', () => {
  // O critério de aceite do §5, em teste direto. É a mesma armadilha que o
  // `contentHash` da SPEC-031 já pagou: as respostas chegam etapa por etapa, e
  // a ordem das chaves de um objeto JS segue a INSERÇÃO — um `stringify`
  // ingênuo daria hashes diferentes para entradas idênticas, e a idempotência
  // morreria em silêncio (o job rodando duas vezes voltaria a pagar o modelo
  // pela mesma resposta).
  it('mesmas chaves em ordem diferente produzem o MESMO hash', () => {
    const ordemA = { ...base, answers: { a: 1, b: 2 } };
    const ordemB = { ...base, answers: { b: 2, a: 1 } };
    expect(inputHashOf(ordemA)).toBe(inputHashOf(ordemB));
  });

  it('ordena em profundidade, não só no primeiro nível', () => {
    const a = { ...base, answers: { etapa: { x: 1, y: 2 } } };
    const b = { ...base, answers: { etapa: { y: 2, x: 1 } } };
    expect(inputHashOf(a)).toBe(inputHashOf(b));
  });

  it('arrays em ordem diferente produzem hashes DIFERENTES', () => {
    // A ordem em que o cliente listou funcionalidades é informação dele, não
    // ruído nosso — ordenar arrays apagaria uma resposta.
    const a = { ...base, answers: { refs: ['a', 'b'] } };
    const b = { ...base, answers: { refs: ['b', 'a'] } };
    expect(inputHashOf(a)).not.toBe(inputHashOf(b));
  });

  it('conteúdo diferente produz hash diferente', () => {
    const outro = { ...base, answers: { 1: { produto: 'app' } } };
    expect(inputHashOf(base)).not.toBe(inputHashOf(outro));
  });
});

describe('inputHashOf: o que entra no hash', () => {
  it('o kind separa as 4 capacidades sobre o mesmo briefing', () => {
    // Sem o kind, as 4 teriam hash idêntico: o hash deixaria de significar
    // "este insumo" e passaria a significar "este briefing".
    expect(inputHashOf({ ...base, kind: 'scope' })).not.toBe(
      inputHashOf({ ...base, kind: 'requirements' }),
    );
  });

  it('promptVersion diferente invalida o hash', () => {
    // O bug que este caso barra é o pior tipo: um prompt corrigido devolveria o
    // artefato velho do índice, e a correção não teria efeito NENHUM — falha
    // que se parece com sucesso.
    expect(inputHashOf({ ...base, promptVersion: 'v1' })).not.toBe(
      inputHashOf({ ...base, promptVersion: 'v2' }),
    );
  });

  it('upstream diferente invalida o hash', () => {
    // Corrigir à mão o `normalize` e regenerar o `scope` tem de produzir um
    // scope novo; sem isto, devolveria o antigo.
    const semUpstream = inputHashOf(base);
    const comUpstream = inputHashOf({
      ...base,
      upstream: { normalize: { texto: 'normalizado' } },
    });
    expect(semUpstream).not.toBe(comUpstream);
  });

  it('upstream ausente e upstream vazio são equivalentes', () => {
    // A equivalência é explícita no código (`?? {}`) em vez de depender de o
    // `canonicalJson` engolir `undefined`.
    expect(inputHashOf(base)).toBe(inputHashOf({ ...base, upstream: {} }));
  });

  it('é estável entre chamadas (sem sal, sem tempo)', () => {
    // Hash de comparação, não segredo: insumo igual PRECISA dar hash igual.
    expect(inputHashOf(base)).toBe(inputHashOf({ ...base }));
  });
});
