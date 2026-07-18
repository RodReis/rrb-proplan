import { Job } from 'bullmq';
import { DocsSyncedEvent } from '../../ingestion/application/sync.service';
import { InsightEventListener, InsightWorker } from './insight.worker';

/**
 * Fiação do contexto RLS na cadeia de IA (SPEC-022 — correção do PR-6): o
 * tenant viaja do DocsSyncedEvent para os 4 jobs, e o worker abre o contexto
 * antes de tocar o banco. Sem isso os jobs de IA morrem sob RLS fail-closed.
 */
describe('InsightEventListener', () => {
  it('propaga o tenant do evento para os 4 jobs enfileirados', async () => {
    const queue = { add: jest.fn() };
    const usage = { canSpend: jest.fn(async () => true) };
    const listener = new InsightEventListener(queue as never, usage as never);

    await listener.onDocsSynced(new DocsSyncedEvent('p1', 'hash1', 't1'));

    expect(queue.add).toHaveBeenCalledTimes(4);
    for (const call of queue.add.mock.calls) {
      expect(call[1]).toMatchObject({
        projectId: 'p1',
        docsScopeHash: 'hash1',
        tenantId: 't1',
      });
    }
  });
});

describe('InsightWorker', () => {
  it('roda o job dentro do contexto do tenant', async () => {
    let contextOpen = false;
    let ranInsideContext = false;
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
    };
    const insight = {
      generateSummary: jest.fn(async () => {
        ranInsideContext = contextOpen;
      }),
    };

    const worker = new InsightWorker(insight as never, prisma as never);
    await worker.process({
      id: '1',
      name: 'summary',
      data: { projectId: 'p1', docsScopeHash: 'h1', tenantId: 't1' },
    } as Job<never>);

    expect(insight.generateSummary).toHaveBeenCalledWith('p1');
    expect(ranInsideContext).toBe(true);
  });
});
