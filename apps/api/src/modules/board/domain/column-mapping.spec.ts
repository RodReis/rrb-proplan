import {
  columnOf,
  DISCARDED_LABEL,
  FINALIZED_LABEL,
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

  it('fechada sem label extra → done (entregue, aguardando aceite do PI)', () => {
    expect(columnOf('closed', [])).toBe('done');
    expect(columnOf('closed', ['proplan:doing'])).toBe('done'); // label residual não muda
  });

  it('fechada com finalizado → finalized (aceito pelo PI)', () => {
    expect(columnOf('closed', [FINALIZED_LABEL])).toBe('finalized');
  });

  it('fechada com descartado → discarded', () => {
    expect(columnOf('closed', [DISCARDED_LABEL])).toBe('discarded');
  });

  it('closes #N (issue fechada por PR, sem label) cai em Feito, NUNCA Finalizado', () => {
    // A razão do mapeamento: nenhuma automação do GitHub pode forjar "aceito pelo PI".
    expect(columnOf('closed', [])).toBe('done');
    expect(columnOf('closed', [])).not.toBe('finalized');
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

  it('finalizar: closed + finalizado, remove as outras labels (nunca open)', () => {
    const t = transitionTo('finalized');
    expect(t.state).toBe('closed');
    expect(t.addLabels).toEqual([FINALIZED_LABEL]);
    expect(t.removeLabels).toContain(DISCARDED_LABEL);
    expect(t.removeLabels).toContain('proplan:doing');
    expect(t.removeLabels).not.toContain(FINALIZED_LABEL);
  });

  it('descartar: closed + descartado, remove finalizado e labels abertas', () => {
    const t = transitionTo('discarded');
    expect(t.state).toBe('closed');
    expect(t.addLabels).toEqual([DISCARDED_LABEL]);
    expect(t.removeLabels).toContain(FINALIZED_LABEL);
    expect(t.removeLabels).toContain('proplan:doing');
    expect(t.removeLabels).not.toContain(DISCARDED_LABEL);
  });

  it('reabrir finalizado/descartado (arrastar para A Fazer): open + todo, remove ambas', () => {
    const t = transitionTo('todo');
    expect(t.state).toBe('open');
    expect(t.addLabels).toEqual(['proplan:todo']);
    expect(t.removeLabels).toContain(DISCARDED_LABEL);
    expect(t.removeLabels).toContain(FINALIZED_LABEL);
  });
});
