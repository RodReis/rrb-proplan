import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sortByLastAccess, touchProject } from './lastAccess';

const p = (id: string) => ({ id });

/**
 * Abre um projeto num instante controlado. Sem fixar o relógio, dois
 * `touchProject` seguidos gravam o mesmo `Date.now()` e não haveria o que
 * ordenar — o teste passaria por sorte do sort estável, não pela regra.
 */
function openAt(id: string, ms: number) {
  vi.setSystemTime(new Date(ms));
  touchProject(id);
}

describe('sortByLastAccess', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.useFakeTimers();
  });
  afterEach(() => vi.useRealTimers());

  it('põe o aberto mais recentemente no topo', () => {
    openAt('a', 1_000);
    openAt('b', 2_000); // b é o mais recente

    expect(sortByLastAccess([p('a'), p('b')]).map((x) => x.id)).toEqual(['b', 'a']);
  });

  it('reordena quando um projeto antigo é reaberto', () => {
    openAt('a', 1_000);
    openAt('b', 2_000);
    openAt('a', 3_000); // `a` volta ao topo

    expect(sortByLastAccess([p('a'), p('b')]).map((x) => x.id)).toEqual(['a', 'b']);
  });

  // Projeto nunca aberto não pode furar a fila de quem foi.
  it('manda os nunca abertos para o fim, preservando a ordem de origem', () => {
    openAt('visto', 1_000);

    const ordem = sortByLastAccess([p('novo1'), p('visto'), p('novo2')]);
    expect(ordem.map((x) => x.id)).toEqual(['visto', 'novo1', 'novo2']);
  });

  it('não muda a ordem quando ninguém foi aberto', () => {
    expect(sortByLastAccess([p('a'), p('b'), p('c')]).map((x) => x.id)).toEqual([
      'a',
      'b',
      'c',
    ]);
  });

  it('não muta o array recebido', () => {
    openAt('b', 1_000);
    const entrada = [p('a'), p('b')];
    sortByLastAccess(entrada);

    expect(entrada.map((x) => x.id)).toEqual(['a', 'b']);
  });

  // O storage é entrada não confiável: JSON corrompido não pode derrubar o combo.
  it('degrada para a ordem de origem quando o storage está corrompido', () => {
    localStorage.setItem('proplan:lastAccess', '{ não é json');

    expect(sortByLastAccess([p('a'), p('b')]).map((x) => x.id)).toEqual(['a', 'b']);
  });

  it('ignora entradas que não são número', () => {
    localStorage.setItem('proplan:lastAccess', JSON.stringify({ a: 'ontem', b: 5 }));

    // `a` tem valor inválido ⇒ tratado como nunca aberto; `b` vence.
    expect(sortByLastAccess([p('a'), p('b')]).map((x) => x.id)).toEqual(['b', 'a']);
  });
});
