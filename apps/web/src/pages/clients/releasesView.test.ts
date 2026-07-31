import { describe, expect, it } from 'vitest';
import type { LicReleaseView } from '../../lib/api';
import {
  isSha256Valido,
  ordenarPorData,
  podeRegistrar,
  publishedLabel,
  publishedTone,
  shortSha,
} from './releasesView';

const SHA = 'a'.repeat(64);

const release = (over: Partial<LicReleaseView> = {}): LicReleaseView => ({
  id: 'rel-1',
  productId: 'prod-1',
  version: '1.2.0',
  os: 'win-x64',
  releasedAt: '2026-06-01T00:00:00.000Z',
  assetId: '12345',
  sha256: SHA,
  notes: null,
  published: true,
  ...over,
});

const form = {
  productId: 'prod-1',
  version: '1.2.0',
  os: 'win-x64',
  releasedAt: '2026-06-01',
  assetId: '12345',
  sha256: SHA,
};

describe('isSha256Valido', () => {
  it('aceita 64 hex, em qualquer caixa', () => {
    expect(isSha256Valido(SHA)).toBe(true);
    expect(isSha256Valido(SHA.toUpperCase())).toBe(true);
    expect(isSha256Valido(` ${SHA} `)).toBe(true);
  });

  it('recusa comprimento errado e caractere não-hex', () => {
    // O modo de errar é caro: hash torto aceito só apareceria na máquina do
    // cliente, depois de 80 MB baixados, como "download corrompido" — mandando
    // o operador caçar problema de rede num erro de digitação.
    expect(isSha256Valido('abc')).toBe(false);
    expect(isSha256Valido('z'.repeat(64))).toBe(false);
    expect(isSha256Valido(`${SHA}a`)).toBe(false);
    expect(isSha256Valido('')).toBe(false);
  });
});

describe('podeRegistrar', () => {
  it('libera com todos os campos obrigatórios', () => {
    expect(podeRegistrar(form)).toBe(true);
  });

  it('barra quando falta qualquer obrigatório', () => {
    for (const campo of [
      'productId',
      'version',
      'os',
      'releasedAt',
      'assetId',
      'sha256',
    ] as const) {
      expect(podeRegistrar({ ...form, [campo]: '' })).toBe(false);
    }
  });

  it('barra com `sha256` malformado, mesmo preenchido', () => {
    expect(podeRegistrar({ ...form, sha256: 'abc' })).toBe(false);
  });

  it('exige `releasedAt` — a data NUNCA é assumida como hoje', () => {
    // Registrar uma release antiga com a data de hoje a tornaria indevidamente
    // autorizada para quem já tem a janela vencida: o oposto exato da promessa
    // da licença perpétua.
    expect(podeRegistrar({ ...form, releasedAt: '   ' })).toBe(false);
  });
});

describe('publishedLabel / publishedTone', () => {
  it('distingue publicada de despublicada', () => {
    expect(publishedLabel(release())).toBe('Publicada');
    expect(publishedLabel(release({ published: false }))).toBe('Despublicada');
  });

  it('"Despublicada" não diz "apagada"', () => {
    // A linha continua e o artefato segue no GitHub; o que mudou é que ela sumiu
    // do `check` e do `download`. Um rótulo "Removida" faria o operador pensar
    // que o binário saiu de circulação.
    expect(publishedLabel(release({ published: false }))).not.toMatch(/apagad|removid/i);
  });

  it('tom acompanha o estado', () => {
    expect(publishedTone(release())).toBe('ok');
    expect(publishedTone(release({ published: false }))).toBe('muted');
  });
});

describe('shortSha', () => {
  it('abrevia hash longo', () => {
    expect(shortSha(SHA)).toBe(`${'a'.repeat(12)}…`);
  });

  it('não mexe no que já é curto', () => {
    expect(shortSha('abc')).toBe('abc');
  });
});

describe('ordenarPorData', () => {
  it('mais nova primeiro', () => {
    const lista = [
      release({ id: 'a', releasedAt: '2026-01-10T00:00:00.000Z' }),
      release({ id: 'c', releasedAt: '2026-09-01T00:00:00.000Z' }),
      release({ id: 'b', releasedAt: '2026-03-01T00:00:00.000Z' }),
    ];

    expect(ordenarPorData(lista).map((r) => r.id)).toEqual(['c', 'b', 'a']);
  });

  it('não muta a lista recebida', () => {
    const lista = [
      release({ id: 'a', releasedAt: '2026-01-10T00:00:00.000Z' }),
      release({ id: 'b', releasedAt: '2026-09-01T00:00:00.000Z' }),
    ];

    ordenarPorData(lista);
    expect(lista.map((r) => r.id)).toEqual(['a', 'b']);
  });
});
