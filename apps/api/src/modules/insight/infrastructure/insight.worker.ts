import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { Job, Queue } from 'bullmq';
import {
  DOCS_SYNCED,
  DocsSyncedEvent,
} from '../../ingestion/application/sync.service';
import { InsightService } from '../application/insight.service';
import { INSIGHT_QUEUE } from '../insight.constants';

interface InsightJobData {
  projectId: string;
  docsScopeHash: string;
}

/**
 * Escuta o evento in-process DocsSynced (emitido quando um sync aplica um
 * hash novo) e enfileira a geração do resumo. jobId por (projeto, hash) evita
 * jobs duplicados para o mesmo estado de docs.
 */
@Injectable()
export class InsightEventListener {
  private readonly logger = new Logger(InsightEventListener.name);

  constructor(
    @InjectQueue(INSIGHT_QUEUE) private readonly queue: Queue<InsightJobData>,
  ) {}

  @OnEvent(DOCS_SYNCED)
  async onDocsSynced(event: DocsSyncedEvent): Promise<void> {
    this.logger.log(`DocsSynced → enfileira resumo do projeto ${event.projectId}`);
    await this.queue.add(
      'summary',
      { projectId: event.projectId, docsScopeHash: event.docsScopeHash },
      {
        jobId: `${event.projectId}_${event.docsScopeHash}`,
        attempts: 2,
        backoff: { type: 'exponential', delay: 5000 },
        removeOnComplete: 50,
        removeOnFail: 50,
      },
    );
    this.logger.log(`DocsSynced → enfileira arestas do projeto ${event.projectId}`);
    await this.queue.add(
      'edges',
      { projectId: event.projectId, docsScopeHash: event.docsScopeHash },
      {
        jobId: `${event.projectId}_edges_${event.docsScopeHash}`,
        attempts: 2,
        backoff: { type: 'exponential', delay: 5000 },
        removeOnComplete: 50,
        removeOnFail: 50,
      },
    );
  }
}

@Processor(INSIGHT_QUEUE)
export class InsightWorker extends WorkerHost {
  private readonly logger = new Logger(InsightWorker.name);

  constructor(private readonly insight: InsightService) {
    super();
  }

  async process(job: Job<InsightJobData>): Promise<void> {
    this.logger.log(`Insight job ${job.id} (${job.name}) → projeto ${job.data.projectId}`);
    if (job.name === 'edges') {
      await this.insight.generateEdges(job.data.projectId);
      return;
    }
    await this.insight.generateSummary(job.data.projectId);
  }
}
