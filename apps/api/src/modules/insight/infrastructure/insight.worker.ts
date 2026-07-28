import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { Job, Queue } from 'bullmq';
import { PrismaService } from '../../../prisma/prisma.service';
import {
  DOCS_SYNCED,
  DocsSyncedEvent,
} from '../../ingestion/application/sync.service';
import { InsightService } from '../application/insight.service';
import { UsageService } from '../../llm';
import { INSIGHT_QUEUE } from '../insight.constants';

interface InsightJobData {
  projectId: string;
  docsScopeHash: string;
  /** Contexto RLS do worker (SPEC-022) — vem do DocsSyncedEvent. */
  tenantId: string;
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
    private readonly usage: UsageService,
  ) {}

  @OnEvent(DOCS_SYNCED)
  async onDocsSynced(event: DocsSyncedEvent): Promise<void> {
    // Gate do teto (SPEC-009): barra ANTES de enfileirar. Um loop de sync não
    // deve queimar a conta — o teto protege às 3h da manhã, o alerta não.
    if (!(await this.usage.canSpend(event.projectId))) {
      this.logger.warn(
        `Teto de gasto de IA atingido — jobs do projeto ${event.projectId} NÃO enfileirados`,
      );
      return;
    }
    this.logger.log(`DocsSynced → enfileira resumo do projeto ${event.projectId}`);
    const data: InsightJobData = {
      projectId: event.projectId,
      docsScopeHash: event.docsScopeHash,
      tenantId: event.tenantId,
    };
    await this.queue.add(
      'summary',
      data,
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
      data,
      {
        jobId: `${event.projectId}_edges_${event.docsScopeHash}`,
        attempts: 2,
        backoff: { type: 'exponential', delay: 5000 },
        removeOnComplete: 50,
        removeOnFail: 50,
      },
    );
    this.logger.log(`DocsSynced → enfileira classificação do projeto ${event.projectId}`);
    await this.queue.add(
      'classify',
      data,
      {
        jobId: `${event.projectId}_classify_${event.docsScopeHash}`,
        attempts: 2,
        backoff: { type: 'exponential', delay: 5000 },
        removeOnComplete: 50,
        removeOnFail: 50,
      },
    );
    this.logger.log(`DocsSynced → enfileira fallback (arquitetura/design) do projeto ${event.projectId}`);
    await this.queue.add(
      'fallback',
      data,
      {
        jobId: `${event.projectId}_fallback_${event.docsScopeHash}`,
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

  constructor(
    private readonly insight: InsightService,
    private readonly prisma: PrismaService,
  ) {
    super();
  }

  async process(job: Job<InsightJobData>): Promise<void> {
    this.logger.log(`Insight job ${job.id} (${job.name}) → projeto ${job.data.projectId}`);
    // Fora de request o RLS é fail-closed (SPEC-022) — todo o job roda sob o
    // contexto do tenant, por operação (nunca uma tx segurada durante a IA).
    await this.prisma.runInTenantContext([job.data.tenantId], () =>
      this.run(job),
    );
  }

  private async run(job: Job<InsightJobData>): Promise<void> {
    if (job.name === 'edges') {
      await this.insight.generateEdges(job.data.projectId);
      return;
    }
    if (job.name === 'classify') {
      await this.insight.classifyAbsent(job.data.projectId);
      return;
    }
    if (job.name === 'fallback') {
      await this.insight.generateFallback(job.data.projectId, 'architecture');
      await this.insight.generateFallback(job.data.projectId, 'design');
      return;
    }
    await this.insight.generateSummary(job.data.projectId);
  }
}
