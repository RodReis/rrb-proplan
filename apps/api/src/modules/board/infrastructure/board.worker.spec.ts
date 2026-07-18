import { Job } from 'bullmq';
import { BoardWorker } from './board.worker';

/**
 * Fiação do contexto RLS no worker do board (SPEC-022 — correção do PR-6):
 * a mutação roda dentro de `runInTenantContext` e o tenant é repassado ao job
 * de projeção agendado — a projeção roda noutro job, fora deste contexto.
 */
describe('BoardWorker', () => {
  it('roda a mutação no contexto do tenant e propaga o tenant à projeção', async () => {
    let contextOpen = false;
    let appliedInsideContext = false;
    const prisma = {
      runInTenantContext: jest.fn(
        async (ids: string[], fn: () => Promise<unknown>) => {
          expect(ids).toEqual(['t1']);
          contextOpen = true;
          try {
            return await fn();
          } finally {
            contextOpen = false;
          }
        },
      ),
      boardMutation: {
        findUnique: jest.fn(async () => ({ id: 'm1', payload: { type: 'move_card' } })),
        update: jest.fn(async () => ({})),
      },
    };
    const applier = {
      apply: jest.fn(async () => {
        appliedInsideContext = contextOpen;
      }),
    };
    const projection = { commitProjection: jest.fn(async () => true) };
    const queue = { add: jest.fn() };

    const worker = new BoardWorker(
      prisma as never,
      applier as never,
      projection as never,
      queue as never,
    );
    await worker.process({
      id: '1',
      name: 'mutation',
      data: { kind: 'mutation', mutationId: 'm1', projectId: 'p1', tenantId: 't1' },
    } as Job<never>);

    expect(appliedInsideContext).toBe(true);
    expect(queue.add).toHaveBeenCalledWith(
      'projection',
      { kind: 'projection', projectId: 'p1', tenantId: 't1' },
      expect.anything(),
    );
  });
});
