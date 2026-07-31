import { describe, expect, it } from 'vitest';
import type { LicReleaseView } from '../../lib/api';
import {
  camposAlterados,
  isSha256Valido,
  normalizarHeadings,
  ordenarPorData,
  paraInputDate,
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

describe('paraInputDate', () => {
  it('devolve o dia gravado, lido em UTC', () => {
    expect(paraInputDate('2026-07-31T00:00:00.000Z')).toBe('2026-07-31');
  });

  it('não recua um dia em fuso negativo — abrir e salvar não altera a data', () => {
    // O defeito que este helper evita é pior que o do FIX #228: lá a data errada
    // só aparecia; aqui ela seria GRAVADA. Abrir a edição de uma release para
    // corrigir o `assetId` e salvar devolveria o dia anterior em `releasedAt` —
    // a tela mexendo sozinha no campo que decide quem tem direito à atualização.
    expect(paraInputDate('2026-01-01T00:00:00.000Z')).toBe('2026-01-01');
    expect(paraInputDate('2026-03-01T00:00:00.000Z')).toBe('2026-03-01');
  });

  it('data inválida vira string vazia', () => {
    expect(paraInputDate('nao-e-data')).toBe('');
  });
});

describe('camposAlterados', () => {
  const original = release({
    releasedAt: '2026-06-01T00:00:00.000Z',
    assetId: '12345',
    sha256: SHA,
    notes: null,
  });

  const doFormulario = {
    releasedAt: '2026-06-01',
    assetId: '12345',
    sha256: SHA,
    notes: '',
  };

  it('formulário intocado não manda campo nenhum', () => {
    // **A asserção central.** Se abrir o formulário já contasse como alteração,
    // toda correção de um campo reescreveria os outros quatro — e um `sha256`
    // reenviado igual dispararia conferência desnecessária no GitHub.
    expect(camposAlterados(doFormulario, original)).toEqual({});
  });

  it('manda só o `assetId` quando só ele mudou — o caso do FIX #242', () => {
    expect(
      camposAlterados({ ...doFormulario, assetId: '497099385' }, original),
    ).toEqual({ assetId: '497099385' });
  });

  it('`notes` vazia contra `null` não conta como mudança', () => {
    // A linha guarda `null`, o formulário guarda `''`. Sem normalizar, toda
    // abertura de formulário pareceria uma alteração da nota.
    expect(camposAlterados({ ...doFormulario, notes: '' }, original)).toEqual({});
  });

  it('apagar uma nota existente manda string vazia — é o que limpa no servidor', () => {
    const comNota = release({ ...original, notes: 'texto antigo' });

    expect(camposAlterados({ ...doFormulario, notes: '' }, comNota)).toEqual({
      notes: '',
    });
  });

  it('`sha256` em maiúsculas igual ao gravado não conta como mudança', () => {
    expect(
      camposAlterados({ ...doFormulario, sha256: SHA.toUpperCase() }, original),
    ).toEqual({});
  });

  it('data alterada volta como ISO', () => {
    expect(camposAlterados({ ...doFormulario, releasedAt: '2026-06-02' }, original)).toEqual({
      releasedAt: '2026-06-02T00:00:00.000Z',
    });
  });
});

describe('normalizarHeadings', () => {
  it('`#Titulo` sem espaço vira heading', () => {
    // Foi o caso real da 1.0.1 do War Room: as notas coladas da Release
    // chegaram como `#Vida da sala`, e sem o espaço o CommonMark não faz
    // heading — o changelog inteiro virava uma lista chapada, e as correções
    // deixavam de se distinguir das novidades.
    expect(normalizarHeadings('#Vida da sala')).toBe('# Vida da sala');
    expect(normalizarHeadings('##Correções')).toBe('## Correções');
  });

  it('heading já correto não muda', () => {
    expect(normalizarHeadings('## Portas')).toBe('## Portas');
  });

  it('`#` no meio da linha não é tocado', () => {
    // `corrigido #242` é referência a issue, não título. Normalizar aqui
    // inventaria uma seção no meio de uma frase.
    expect(normalizarHeadings('corrigido #242 e #238')).toBe('corrigido #242 e #238');
  });

  it('age em todas as linhas, não só na primeira', () => {
    expect(normalizarHeadings('#Um\ntexto\n##Dois')).toBe('# Um\ntexto\n## Dois');
  });

  it('não passa de 6 `#` — além disso não é heading em CommonMark', () => {
    expect(normalizarHeadings('#######Sete')).toBe('#######Sete');
  });

  it('não altera texto sem heading', () => {
    expect(normalizarHeadings('- item\n- outro')).toBe('- item\n- outro');
  });
});
