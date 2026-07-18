import { Job } from 'bullmq';
import { SyncJobData } from '../application/ingestion.service';
import { SyncWorker } from './sync.worker';

/**
 * Fiação do contexto RLS no worker (SPEC-022 — correção do PR-6): o job DEVE
 * rodar dentro de `runInTenantContext` com o tenant do job. Sem isso o RLS
 * fail-closed corta tudo e o run fica `queued` para sempre (o bug do timeout
 * com polling infinito no front).
 */
describe('SyncWorker', () => {
  it('abre o contexto do tenant do job e roda o sync DENTRO dele', async () => {
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
    const sync = {
      runSync: jest.fn(async () => {
        ranInsideContext = contextOpen;
      }),
    };

    const worker = new SyncWorker(sync as never, prisma as never);
    await worker.process({
      id: '1',
      data: { syncRunId: 'run-1', tenantId: 't1' },
    } as Job<SyncJobData>);

    expect(prisma.runInTenantContext).toHaveBeenCalledTimes(1);
    expect(sync.runSync).toHaveBeenCalledWith('run-1');
    expect(ranInsideContext).toBe(true);
  });
});
