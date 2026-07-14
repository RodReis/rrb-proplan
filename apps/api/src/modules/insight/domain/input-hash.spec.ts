import { computeInputHash, InputHashParts } from './input-hash';

const base: InputHashParts = {
  system: 'Você é um assistente.',
  user: 'Resuma os documentos abaixo.\n# README\n...',
  provider: 'anthropic',
  model: 'claude-sonnet-5',
};

describe('computeInputHash', () => {
  it('é determinístico: mesmos parts → mesmo hash (risco de prompt não-determinístico)', () => {
    // O teste que a spec pede: rodar duas vezes sobre a MESMA entrada e exigir
    // hash idêntico. Se um builder de prompt introduzir data/hora ou ordenação
    // instável, este teste (aplicado ao builder real) quebra.
    expect(computeInputHash(base)).toBe(computeInputHash(base));
  });

  it('é um SHA-256 hex (64 chars)', () => {
    expect(computeInputHash(base)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('muda quando o system muda', () => {
    expect(computeInputHash({ ...base, system: base.system + ' ' })).not.toBe(computeInputHash(base));
  });

  it('muda quando o user muda', () => {
    expect(computeInputHash({ ...base, user: base.user + '!' })).not.toBe(computeInputHash(base));
  });

  it('muda quando o provider muda', () => {
    expect(computeInputHash({ ...base, provider: 'openai' })).not.toBe(computeInputHash(base));
  });

  it('muda quando o model muda (trocar de modelo é input novo — SPEC-011)', () => {
    expect(computeInputHash({ ...base, model: 'claude-opus-4-8' })).not.toBe(computeInputHash(base));
  });

  it('concatenação é injetiva: mover um char de um campo para o vizinho muda o hash', () => {
    // "ab"|"c" vs "a"|"bc" — sem o separador \0 colidiriam.
    const a = computeInputHash({ ...base, system: 'ab', user: 'c' });
    const b = computeInputHash({ ...base, system: 'a', user: 'bc' });
    expect(a).not.toBe(b);
  });
});
