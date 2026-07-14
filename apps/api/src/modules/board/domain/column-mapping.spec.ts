import {
  columnOf,
  COLUMN_LABEL,
  DISCARDED_LABEL,
  FINALIZED_LABEL,
  isClosedOutsideProplan,
  priorityOf,
  transitionTo,
} from './column-mapping';

// ADR-011 (corrigido 2026-07-13) + SPEC-005: as colunas ABERTAS são
// backlog/todo/doing/**done**; só Finalizado e Descartado fecham a issue.
// Feito = `open` + `proplan:done` (entregue, aguardando aceite — a issue não
// fecha por merge; fechar é ato deliberado do dono).

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

  it('Feito é ABERTA: open + proplan:done → done (entregue, aguardando aceite)', () => {
    expect(columnOf('open', [COLUMN_LABEL.done])).toBe('done');
    expect(columnOf('open', ['proplan:done', 'prio:alta'])).toBe('done');
  });

  it('done tem precedência sobre doing/todo se coexistirem (label residual)', () => {
    expect(columnOf('open', ['proplan:doing', 'proplan:done'])).toBe('done');
  });

  it('fechada com finalizado → finalized (aceito pelo dono)', () => {
    expect(columnOf('closed', [FINALIZED_LABEL])).toBe('finalized');
  });

  it('fechada com descartado → discarded', () => {
    expect(columnOf('closed', [DISCARDED_LABEL])).toBe('discarded');
  });

  it('fechada SEM label proplan:* → finalized (fechada fora do ProPlan), NUNCA Feito', () => {
    // SPEC-005 linha 119: em repo comum, closed significa concluído; forçar um
    // estado exótico imporia nossa convenção (ADR-014). Cai em Finalizado, mas
    // sinalizada — nunca em Feito (Feito é aberta, aguardando aceite).
    expect(columnOf('closed', [])).toBe('finalized');
    expect(columnOf('closed', ['proplan:doing'])).toBe('finalized'); // label residual não muda
    expect(columnOf('closed', [])).not.toBe('done');
  });

  it('doing tem precedência sobre todo se ambas as labels existirem', () => {
    expect(columnOf('open', ['proplan:todo', 'proplan:doing'])).toBe('doing');
  });
});

describe('isClosedOutsideProplan', () => {
  it('closed sem finalizado/descartado → true (badge "fechada fora do ProPlan")', () => {
    expect(isClosedOutsideProplan('closed', [])).toBe(true);
    expect(isClosedOutsideProplan('closed', ['proplan:doing'])).toBe(true); // label residual
  });
  it('closed com finalizado ou descartado → false (fechada pelo fluxo)', () => {
    expect(isClosedOutsideProplan('closed', [FINALIZED_LABEL])).toBe(false);
    expect(isClosedOutsideProplan('closed', [DISCARDED_LABEL])).toBe(false);
  });
  it('aberta → false (nem se aplica)', () => {
    expect(isClosedOutsideProplan('open', [])).toBe(false);
    expect(isClosedOutsideProplan('open', [COLUMN_LABEL.done])).toBe(false);
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

  it('mover para Feito: ABERTA + proplan:done, remove as outras (NÃO fecha a issue)', () => {
    const t = transitionTo('done');
    expect(t.state).toBe('open');
    expect(t.addLabels).toEqual(['proplan:done']);
    expect(t.removeLabels).toContain('proplan:doing');
    expect(t.removeLabels).toContain(FINALIZED_LABEL);
    expect(t.removeLabels).not.toContain('proplan:done');
  });

  it('finalizar: closed + finalizado, remove as outras labels (nunca open)', () => {
    const t = transitionTo('finalized');
    expect(t.state).toBe('closed');
    expect(t.addLabels).toEqual([FINALIZED_LABEL]);
    expect(t.removeLabels).toContain(DISCARDED_LABEL);
    expect(t.removeLabels).toContain('proplan:done');
    expect(t.removeLabels).not.toContain(FINALIZED_LABEL);
  });

  it('descartar: closed + descartado, remove finalizado e labels abertas (inclui done)', () => {
    const t = transitionTo('discarded');
    expect(t.state).toBe('closed');
    expect(t.addLabels).toEqual([DISCARDED_LABEL]);
    expect(t.removeLabels).toContain(FINALIZED_LABEL);
    expect(t.removeLabels).toContain('proplan:done');
    expect(t.removeLabels).not.toContain(DISCARDED_LABEL);
  });

  it('reabrir finalizado/descartado (arrastar para A Fazer): open + todo, remove ambas', () => {
    const t = transitionTo('todo');
    expect(t.state).toBe('open');
    expect(t.addLabels).toEqual(['proplan:todo']);
    expect(t.removeLabels).toContain(DISCARDED_LABEL);
    expect(t.removeLabels).toContain(FINALIZED_LABEL);
  });

  it('coluna inválida (ex.: número vazado do dnd) → lança, não retorna undefined', () => {
    // Regressão do bug: soltar sobre um card fazia toColumn virar o número da
    // issue; transitionTo(12) retornava undefined e estourava undefined.removeLabels.
    expect(() => transitionTo(12 as never)).toThrow(/inválida/);
    expect(() => transitionTo('finalizado' as never)).toThrow(/inválida/); // valor != enum
  });
});
