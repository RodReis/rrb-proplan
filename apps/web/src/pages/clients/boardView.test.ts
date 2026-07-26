import { describe, expect, it } from 'vitest';
import type { FunnelCard, FunnelBoardColumn } from '../../lib/api';
import {
  applyConfirmedState,
  cardSubtitle,
  columnOf,
  initials,
  moveCard,
} from './boardView';

function card(id: string, over: Partial<FunnelCard> = {}): FunnelCard {
  return {
    id,
    clientId: 'c1',
    title: `Projeto ${id}`,
    description: null,
    state: 'DRAFT',
    createdAt: '2026-07-25T00:00:00Z',
    updatedAt: '2026-07-25T00:00:00Z',
    client: { id: 'c1', name: 'Cliente Um', company: 'ACME' },
    ...over,
  };
}

function board(): FunnelBoardColumn[] {
  return [
    { column: 'novo', cards: [card('a'), card('b')] },
    { column: 'briefing', cards: [card('c', { state: 'BRIEFING_STARTED' })] },
    { column: 'prompt_contrato', cards: [] },
    { column: 'producao_entrega', cards: [] },
  ];
}

describe('Kanban de clientes: movimento otimista (SPEC-029)', () => {
  it('move o card para a coluna alvo sem mutar o board original', () => {
    const original = board();
    const next = moveCard(original, 'a', 'briefing');

    expect(next[0].cards.map((c) => c.id)).toEqual(['b']);
    expect(next[1].cards.map((c) => c.id)).toEqual(['a', 'c']);
    // O board original tem de sobreviver intacto — é ele que o rollback restaura.
    expect(original[0].cards.map((c) => c.id)).toEqual(['a', 'b']);
    expect(original[1].cards.map((c) => c.id)).toEqual(['c']);
  });

  it('rollback: reaplicar o board guardado desfaz o movimento', () => {
    const original = board();
    const optimistic = moveCard(original, 'a', 'producao_entrega');
    expect(optimistic[3].cards.map((c) => c.id)).toEqual(['a']);

    // É exatamente o que o catch do caller faz quando a API devolve 422.
    expect(original[0].cards.map((c) => c.id)).toEqual(['a', 'b']);
    expect(original[3].cards).toHaveLength(0);
  });

  it('mover para a MESMA coluna devolve o board por identidade (não dispara request)', () => {
    const original = board();
    // `toBe`, não `toEqual`: o caller usa a identidade para saber que nada mudou.
    expect(moveCard(original, 'a', 'novo')).toBe(original);
  });

  it('card inexistente devolve o board por identidade', () => {
    const original = board();
    expect(moveCard(original, 'fantasma', 'briefing')).toBe(original);
  });

  it('columnOf acha a coluna atual e devolve null para card ausente', () => {
    const b = board();
    expect(columnOf(b, 'a')).toBe('novo');
    expect(columnOf(b, 'c')).toBe('briefing');
    expect(columnOf(b, 'fantasma')).toBeNull();
  });

  it('applyConfirmedState corrige o rótulo com o estado que o servidor devolveu', () => {
    // A UI move por COLUNA; o servidor responde o ESTADO interno. Sem isto o
    // card fica na coluna certa com o rótulo antigo até o próximo refetch.
    const moved = moveCard(board(), 'a', 'briefing');
    const confirmed = applyConfirmedState(moved, 'a', 'BRIEFING_STARTED');

    expect(confirmed[1].cards.find((c) => c.id === 'a')!.state).toBe(
      'BRIEFING_STARTED',
    );
    // Nenhum outro card é tocado.
    expect(confirmed[1].cards.find((c) => c.id === 'c')!.state).toBe(
      'BRIEFING_STARTED',
    );
    expect(confirmed[0].cards.find((c) => c.id === 'b')!.state).toBe('DRAFT');
  });
});

describe('apresentação do card', () => {
  it('iniciais: uma palavra, duas palavras, nome composto', () => {
    // Acento preservado: nome próprio em pt-BR é a regra, não a exceção —
    // normalizar para ASCII escreveria o nome do cliente errado.
    expect(initials('Construtora Ática')).toBe('CÁ');
    expect(initials('Organize')).toBe('OR');
    expect(initials('Maria da Silva Prado')).toBe('MP');
  });

  it('iniciais aguentam nome vazio ou só espaços', () => {
    expect(initials('')).toBe('?');
    expect(initials('   ')).toBe('?');
  });

  it('subtítulo mostra a empresa quando há, e só o nome quando não', () => {
    expect(cardSubtitle(card('a'))).toBe('Cliente Um · ACME');
    expect(
      cardSubtitle(card('a', { client: { id: 'c', name: 'Só Nome', company: null } })),
    ).toBe('Só Nome');
  });
});
