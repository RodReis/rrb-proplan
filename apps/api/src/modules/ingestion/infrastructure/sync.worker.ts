import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { PrismaService } from '../../../prisma/prisma.service';
import { SyncJobData } from '../application/ingestion.service';
import { SyncService } from '../application/sync.service';
import { SYNC_QUEUE } from '../ingestion.constants';

/**
 * Worker BullMQ da fila `sync`, rodando no mesmo processo Nest (SPEC-002 —
 * sem processo separado nesta fatia). Timeout de 60s por job é imposto pelos
 * timeouts dos clients GitHub (10s/request) + retry (3 tentativas via enqueue).
 *
 * Roda fora de request → sem o `runInTenantContext` o RLS (fail-closed,
 * SPEC-022) cortaria toda query e o run ficaria `queued` para sempre. Os
 * listeners in-process do sync (board, canonical, insight) herdam o contexto
 * pelo AsyncLocalStorage.
 */
@Processor(SYNC_QUEUE)
export class SyncWorker extends WorkerHost {
  private readonly logger = new Logger(SyncWorker.name);

  constructor(
    private readonly sync: SyncService,
    private readonly prisma: PrismaService,
  ) {
    super();
  }

  async process(job: Job<SyncJobData>): Promise<void> {
    this.logger.log(`Sync job ${job.id} → run ${job.data.syncRunId}`);
    await this.prisma.runInTenantContext([job.data.tenantId], () =>
      this.sync.runSync(job.data.syncRunId),
    );
  }
}
