import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { SyncJobData } from '../application/ingestion.service';
import { SyncService } from '../application/sync.service';
import { SYNC_QUEUE } from '../ingestion.constants';

/**
 * Worker BullMQ da fila `sync`, rodando no mesmo processo Nest (SPEC-002 —
 * sem processo separado nesta fatia). Timeout de 60s por job é imposto pelos
 * timeouts dos clients GitHub (10s/request) + retry (3 tentativas via enqueue).
 */
@Processor(SYNC_QUEUE)
export class SyncWorker extends WorkerHost {
  private readonly logger = new Logger(SyncWorker.name);

  constructor(private readonly sync: SyncService) {
    super();
  }

  async process(job: Job<SyncJobData>): Promise<void> {
    this.logger.log(`Sync job ${job.id} → run ${job.data.syncRunId}`);
    await this.sync.runSync(job.data.syncRunId);
  }
}
