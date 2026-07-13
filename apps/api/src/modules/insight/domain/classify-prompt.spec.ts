import { parseClassify } from './classify-prompt';

describe('parseClassify', () => {
  it('parseia array JSON de {entity,path,spans}', () => {
    const text =
      '```json\n[{"entity":"architecture","path":"docs/tech.md","spans":["Este documento descreve os módulos e a comunicação entre eles"]}]\n```';
    const hits = parseClassify(text);
    expect(hits).toEqual([
      { entity: 'architecture', path: 'docs/tech.md', spans: ['Este documento descreve os módulos e a comunicação entre eles'] },
    ]);
  });

  it('descarta item sem spans (ADR-012 — procedência obrigatória)', () => {
    const text = '[{"entity":"architecture","path":"docs/tech.md","spans":[]}]';
    expect(parseClassify(text)).toHaveLength(0);
  });

  it('descarta item sem campo spans', () => {
    const text = '[{"entity":"architecture","path":"docs/tech.md"}]';
    expect(parseClassify(text)).toHaveLength(0);
  });

  it('descarta entity fora do conjunto classificável', () => {
    const text = '[{"entity":"convention","path":"docs/tech.md","spans":["x"]}]';
    expect(parseClassify(text)).toHaveLength(0);
  });

  it('descarta deploy mesmo com spans válidos', () => {
    const text = '[{"entity":"deploy","path":"docs/tech.md","spans":["x"]}]';
    expect(parseClassify(text)).toHaveLength(0);
  });

  it('descarta path vazio', () => {
    const text = '[{"entity":"architecture","path":"","spans":["x"]}]';
    expect(parseClassify(text)).toHaveLength(0);
  });

  it('JSON malformado → lança (caller faz retry)', () => {
    expect(() => parseClassify('nao e json')).toThrow();
  });
});
