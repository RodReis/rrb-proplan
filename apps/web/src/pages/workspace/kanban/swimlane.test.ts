import { describe, expect, it } from 'vitest';
import { BoardCard, BoardView } from '../../../lib/api';
import { orderedSwimlanes } from './KanbanTab';
import { cellDropId, columnFromDropId } from './KanbanSwimlane';

function card(over: Partial<BoardCard> & Pick<BoardCard, 'number'>): BoardCard {
  return {
    title: 'T',
    column: 'todo',
    priority: null,
    assignee: null,
    htmlUrl: 'u',
    createdAt: '2026-01-01T00:00:00Z',
    closedAt: null,
    closedOutside: false,
    parentNumber: null,
    ...over,
  };
}

function board(over: Partial<BoardView> = {}): BoardView {
  return {
    mode: 'active',
    needsIssueImport: false,
    columns: [],
    epics: [],
    ...over,
  };
}

describe('orderedSwimlanes', () => {
  it('ordena épicos por número e põe "sem épico" por último', () => {
    const b = board({
      epics: [
        { number: 30, title: 'MVP3', htmlUrl: 'u', closedChildren: 0, totalChildren: 0 },
        { number: 10, title: 'MVP1', htmlUrl: 'u', closedChildren: 0, totalChildren: 0 },
      ],
      columns: [{ column: 'todo', cards: [] }],
    });
    const lanes = orderedSwimlanes(b);
    expect(lanes.map((l) => (l.epic ? l.epic.number : 'none'))).toEqual([10, 30, 'none']);
  });

  it('roteia a filha para a faixa do seu épico, na coluna real', () => {
    const b = board({
      epics: [{ number: 95, title: 'Épico', htmlUrl: 'u', closedChildren: 0, totalChildren: 1 }],
      columns: [{ column: 'doing', cards: [card({ number: 96, column: 'doing', parentNumber: 95 })] }],
    });
    const lane = orderedSwimlanes(b).find((l) => l.epic?.number === 95)!;
    expect(lane.cardsByColumn.get('doing')!.map((c) => c.number)).toEqual([96]);
    expect(lane.cardsByColumn.get('todo')).toEqual([]);
  });

  it('card raiz (parentNumber null) cai em "sem épico"', () => {
    const b = board({
      epics: [{ number: 95, title: 'E', htmlUrl: 'u', closedChildren: 0, totalChildren: 0 }],
      columns: [{ column: 'todo', cards: [card({ number: 8 })] }],
    });
    const none = orderedSwimlanes(b).find((l) => l.epic === null)!;
    expect(none.cardsByColumn.get('todo')!.map((c) => c.number)).toEqual([8]);
  });

  it('filha cujo épico não está presente (pai fechou) cai em "sem épico"', () => {
    const b = board({
      epics: [], // nenhum épico aberto
      columns: [{ column: 'todo', cards: [card({ number: 96, parentNumber: 999 })] }],
    });
    const lanes = orderedSwimlanes(b);
    const none = lanes.find((l) => l.epic === null)!;
    expect(none.cardsByColumn.get('todo')!.map((c) => c.number)).toEqual([96]);
  });
});

describe('cellDropId / columnFromDropId', () => {
  it('round-trip: extrai a coluna do dropId da célula', () => {
    expect(columnFromDropId(cellDropId('95', 'doing'))).toBe('doing');
    expect(columnFromDropId(cellDropId('none', 'backlog'))).toBe('backlog');
  });

  it('id sem ":" (board plano, coluna nua) retorna a própria coluna', () => {
    expect(columnFromDropId('finalized')).toBe('finalized');
  });
});
