import { nextTask, NextTaskInput, TaskCandidate } from './next-task';

const c = (number: number, priorityRank: number): TaskCandidate => ({
  number,
  url: `https://github.com/o/r/issues/${number}`,
  title: `issue ${number}`,
  priorityRank,
});

const base: NextTaskInput = {
  candidates: [c(42, 0), c(38, 1), c(51, 2)],
  excluded: [],
  stateConfidence: 0.8,
  belowThreshold: false,
};

describe('nextTask (SPEC-016 §get_next_task)', () => {
  it('pega o de maior prioridade, referência número+URL (sem corpo)', () => {
    const d = nextTask(base);
    expect(d.pick?.number).toBe(42);
    expect(d.pick?.url).toContain('/issues/42');
    expect(d).not.toHaveProperty('body');
  });

  it('exclui #51 (constraint) e #38 (decisão ausente) → sobra #42', () => {
    const d = nextTask({
      ...base,
      candidates: [c(38, 0), c(51, 1), c(42, 2)],
      excluded: [
        { number: 51, reason: 'restrição a-revalidar: não mexer no billing' },
        { number: 38, reason: 'bloqueio: decisão de arquitetura ausente' },
      ],
    });
    expect(d.pick?.number).toBe(42);
    expect(d.excluded.map((e) => e.number).sort()).toEqual([38, 51]);
  });

  it('abaixo do limiar → recusa, não recomenda nada', () => {
    const d = nextTask({ ...base, belowThreshold: true });
    expect(d.pick).toBeNull();
    expect(d.refusal?.reason).toContain('limiar');
  });

  it('todos excluídos → recusa com o que falta', () => {
    const d = nextTask({
      ...base,
      excluded: [
        { number: 42, reason: 'x' },
        { number: 38, reason: 'y' },
        { number: 51, reason: 'z' },
      ],
    });
    expect(d.pick).toBeNull();
    expect(d.refusal?.missing).toBeTruthy();
  });

  it('coluna vazia → recusa "nenhuma issue"', () => {
    const d = nextTask({ ...base, candidates: [] });
    expect(d.pick).toBeNull();
    expect(d.refusal?.reason).toContain('nenhuma issue');
  });
});
