import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { PrismaService } from '../../../prisma/prisma.service';
import type { WebhookJobData } from '../application/webhook-intake.service';
import { WebhookProcessorService } from '../application/webhook-processor.service';
import { LICENSING_QUEUE } from '../licensing.constants';

/**
 * Processa o evento de webhook fora da request (SPEC-038 §Notas técnicas).
 *
 * **`concurrency: 1`**, como o `board`. Dois eventos da mesma venda processados
 * em paralelo disputariam a emissão: o `saleRef` único do banco recusaria o
 * segundo, mas com erro na lista de pendências em vez de silêncio — e o volume
 * do piloto não pede paralelismo nenhum.
 */
@Processor(LICENSING_QUEUE, { concurrency: 1 })
export class LicensingWorker extends WorkerHost {
  private readonly logger = new Logger(LicensingWorker.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly processor: WebhookProcessorService,
  ) {
    super();
  }

  async process(job: Job<WebhookJobData>): Promise<void> {
    const { webhookEventId, tenantId } = job.data;
    this.logger.log(`Licensing job ${job.id} → evento ${webhookEventId}`);

    // Fora de request o RLS é fail-closed: ler ou gravar sem contexto NÃO dá
    // erro, dá ZERO LINHAS. Um evento "processado" que não achou a licença tem
    // a mesma cara de um evento cuja venda não existe.
    await this.prisma.runInTenantContext([tenantId], () =>
      this.processor.process(webhookEventId, tenantId),
    );
  }
}
