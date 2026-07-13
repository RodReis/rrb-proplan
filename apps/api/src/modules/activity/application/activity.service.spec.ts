import { NotFoundException } from '@nestjs/common';
import { ActivityService } from './activity.service';
import { Step } from '../domain/operation-steps';

/**
 * Prisma mock: guarda uma Operation em memória para exercer o ciclo
 * start → advance → finish/fail e a derivação lazy do SyncRun no get.
 */
function makePrisma(seed?: { operation?: any; syncRun?: any }) {
  const store: { op: any; run: any } = {
    op: seed?.operation ?? null,
    run: seed?.syncRun ?? null,
  };
  return {
    store,
    prisma: {
      operation: {
        create: jest.fn(({ data }) => {
          store.op = { id: 'op1', ...data, commitUrl: null, syncRunId: null, error: null, startedAt: new Date(), finishedAt: null };
          return Promise.resolve(store.op);
        }),
        findUnique: jest.fn(() => Promise.resolve(store.op)),
        findFirst: jest.fn(() => Promise.resolve(store.op)),
        update: jest.fn(({ data }) => {
          store.op = { ...store.op, ...data };
          return Promise.resolve(store.op);
        }),
      },
      syncRun: {
        findUnique: jest.fn(() => Promise.resolve(store.run)),
      },
    } as any,
  };
}

describe('ActivityService', () => {
  it('start: cria operação running com 1º passo running', async () => {
    const { prisma, store } = makePrisma();
    const svc = new ActivityService(prisma);

    const id = await svc.start('p1', 'promote', 'docs/DESIGN.md');

    expect(id).toBe('op1');
    expect(store.op.status).toBe('running');
    const steps = store.op.steps as Step[];
    expect(steps[0].status).toBe('running');
    expect(steps[0].label).toContain('docs/DESIGN.md');
  });

  it('advance: move o passo e marca anteriores done', async () => {
    const { prisma, store } = makePrisma();
    const svc = new ActivityService(prisma);
    await svc.start('p1', 'promote', 'x');

    await svc.advance('op1', 'sync');

    const steps = store.op.steps as Step[];
    expect(steps.find((s) => s.key === 'commit')!.status).toBe('done');
    expect(steps.find((s) => s.key === 'sync')!.status).toBe('running');
  });

  it('finish: status done + todos os passos done', async () => {
    const { prisma, store } = makePrisma();
    const svc = new ActivityService(prisma);
    await svc.start('p1', 'promote', 'x');

    await svc.finish('op1');

    expect(store.op.status).toBe('done');
    expect((store.op.steps as Step[]).every((s) => s.status === 'done')).toBe(true);
    expect(store.op.finishedAt).toBeInstanceOf(Date);
  });

  it('fail: status failed + passo running vira failed + erro gravado', async () => {
    const { prisma, store } = makePrisma();
    const svc = new ActivityService(prisma);
    await svc.start('p1', 'promote', 'x');

    await svc.fail('op1', 'boom');

    expect(store.op.status).toBe('failed');
    expect(store.op.error).toBe('boom');
    expect((store.op.steps as Step[])[0].status).toBe('failed');
  });

  it('get: operação sem dono → NotFound', async () => {
    const { prisma } = makePrisma(); // store.op = null → findFirst devolve null
    const svc = new ActivityService(prisma);
    await expect(svc.get('u1', 'op1')).rejects.toThrow(NotFoundException);
  });

  describe('get — derivação lazy do SyncRun', () => {
    function running(syncRunId: string | null) {
      return {
        id: 'op1', kind: 'promote', status: 'running',
        steps: [{ key: 'sync', label: 'Sincronizando…', status: 'running' }],
        commitUrl: null, syncRunId, error: null, startedAt: new Date(), finishedAt: null,
      };
    }

    it('SyncRun success → operação conclui sozinha (done)', async () => {
      const { prisma, store } = makePrisma({
        operation: running('run1'),
        syncRun: { status: 'success', error: null },
      });
      const svc = new ActivityService(prisma);

      const view = await svc.get('u1', 'op1');

      expect(view.status).toBe('done');
      expect(store.op.status).toBe('done');
    });

    it('SyncRun failed → operação falha com o erro do run', async () => {
      const { prisma } = makePrisma({
        operation: running('run1'),
        syncRun: { status: 'failed', error: 'trees timeout' },
      });
      const svc = new ActivityService(prisma);

      const view = await svc.get('u1', 'op1');

      expect(view.status).toBe('failed');
      expect(view.error).toBe('trees timeout');
    });

    it('SyncRun ainda running → operação segue running (não conclui à toa)', async () => {
      const { prisma } = makePrisma({
        operation: running('run1'),
        syncRun: { status: 'running', error: null },
      });
      const svc = new ActivityService(prisma);

      const view = await svc.get('u1', 'op1');

      expect(view.status).toBe('running');
    });
  });
});
