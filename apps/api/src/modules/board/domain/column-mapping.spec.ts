import {
  columnOf,
  DISCARDED_LABEL,
  priorityOf,
  transitionTo,
} from './column-mapping';

describe('columnOf', () => {
  it('aberta sem label proplan:* → backlog (default da spec)', () => {
    expect(columnOf('open', [])).toBe('backlog');
    expect(columnOf('open', ['bug', 'prio:alta'])).toBe('backlog');
  });

  it('aberta com proplan:backlog/todo/doing → coluna correspondente', () => {
    expect(columnOf('open', ['proplan:backlog'])).toBe('backlog');
    expect(columnOf('open', ['proplan:todo'])).toBe('todo');
    expect(columnOf('open', ['proplan:doing'])).toBe('doing');
  });

  it('fechada sem descartado → done', () => {
    expect(columnOf('closed', [])).toBe('done');
    expect(columnOf('closed', ['proplan:doing'])).toBe('done'); // label residual não muda
  });

  it('fechada com descartado → discarded (distinguível de done)', () => {
    expect(columnOf('closed', [DISCARDED_LABEL])).toBe('discarded');
  });

  it('doing tem precedência sobre todo se ambas as labels existirem', () => {
    expect(columnOf('open', ['proplan:todo', 'proplan:doing'])).toBe('doing');
  });
});

describe('priorityOf', () => {
  it('lê prio:* das labels', () => {
    expect(priorityOf(['prio:alta'])).toBe('alta');
    expect(priorityOf(['prio:media'])).toBe('media');
    expect(priorityOf(['prio:baixa'])).toBe('baixa');
  });
  it('sem prio:* → null', () => {
    expect(priorityOf(['bug'])).toBeNull();
  });
  it('alta tem precedência', () => {
    expect(priorityOf(['prio:baixa', 'prio:alta'])).toBe('alta');
  });
});

describe('transitionTo', () => {
  it('mover para coluna aberta: open + label da coluna, remove as outras', () => {
    const t = transitionTo('doing');
    expect(t.state).toBe('open');
    expect(t.addLabels).toEqual(['proplan:doing']);
    expect(t.removeLabels).toContain('proplan:todo');
    expect(t.removeLabels).toContain('proplan:backlog');
    expect(t.removeLabels).toContain(DISCARDED_LABEL);
  });

  it('mover para Feito: closed, remove todas as labels de coluna', () => {
    const t = transitionTo('done');
    expect(t.state).toBe('closed');
    expect(t.addLabels).toEqual([]);
    expect(t.removeLabels).toContain('proplan:doing');
    expect(t.removeLabels).toContain(DISCARDED_LABEL);
  });

  it('descartar: closed + descartado, remove labels de coluna aberta', () => {
    const t = transitionTo('discarded');
    expect(t.state).toBe('closed');
    expect(t.addLabels).toEqual([DISCARDED_LABEL]);
    expect(t.removeLabels).toEqual([
      'proplan:backlog',
      'proplan:todo',
      'proplan:doing',
    ]);
  });

  it('reabrir descartado (arrastar para A Fazer): open + todo, remove descartado', () => {
    const t = transitionTo('todo');
    expect(t.state).toBe('open');
    expect(t.addLabels).toEqual(['proplan:todo']);
    expect(t.removeLabels).toContain(DISCARDED_LABEL);
  });
});
