import {
  advanceTo,
  buildSteps,
  markAllDone,
  markFailed,
} from './operation-steps';

describe('operation-steps', () => {
  describe('buildSteps', () => {
    it('promote: 4 passos, todos pending, {doc} substituído pelo path', () => {
      const steps = buildSteps('promote', 'docs/ARCHITECTURE.md');
      expect(steps).toHaveLength(4);
      expect(steps.every((s) => s.status === 'pending')).toBe(true);
      expect(steps[0].label).toContain('docs/ARCHITECTURE.md');
      expect(steps[0].label).not.toContain('{doc}');
    });

    it('bootstrap: 3 passos (cria issues + sincroniza board, sem sync de doc)', () => {
      expect(buildSteps('bootstrap')).toHaveLength(3);
    });

    it('sem doc → placeholder vira "o documento", nunca fica {doc} cru', () => {
      const label = buildSteps('bootstrap')[0].label;
      expect(label).not.toContain('{doc}');
    });

    it('nenhum label contém jargão técnico (202, docsTreeSha, enqueueSync)', () => {
      const all = (['promote', 'mapping', 'bootstrap'] as const)
        .flatMap((k) => buildSteps(k, 'docs/X.md'))
        .map((s) => s.label)
        .join(' ');
      expect(all).not.toMatch(/202|docsTreeSha|enqueueSync|blobSha|noop/i);
    });
  });

  describe('advanceTo', () => {
    it('marca anteriores done, o alvo running, posteriores intactos', () => {
      const steps = buildSteps('promote', 'x');
      const r = advanceTo(steps, 'sync'); // 3º passo (idx 2)
      expect(r[0].status).toBe('done');
      expect(r[1].status).toBe('done');
      expect(r[2].status).toBe('running');
      expect(r[3].status).toBe('pending');
    });

    it('key inexistente → retorna a lista sem mudança', () => {
      const steps = buildSteps('promote', 'x');
      expect(advanceTo(steps, 'nope')).toBe(steps);
    });
  });

  describe('markAllDone', () => {
    it('todos os passos viram done', () => {
      const r = markAllDone(buildSteps('promote', 'x'));
      expect(r.every((s) => s.status === 'done')).toBe(true);
    });
  });

  describe('markFailed', () => {
    it('marca o passo running como failed', () => {
      const steps = advanceTo(buildSteps('promote', 'x'), 'sync');
      const r = markFailed(steps);
      expect(r[2].status).toBe('failed');
      expect(r[0].status).toBe('done'); // anteriores intactos
    });

    it('sem passo running → marca o 1º pending como failed', () => {
      const r = markFailed(buildSteps('promote', 'x'));
      expect(r[0].status).toBe('failed');
    });
  });
});
