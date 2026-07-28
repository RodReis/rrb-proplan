import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { PrismaService } from '../../../prisma/prisma.service';
import { EffortBreakdownService } from '../application/effort-breakdown.service';
import { ESTIMATES_QUEUE } from '../estimates.constants';

export interface EffortJobData {
  clientProjectId: string;
  /** Contexto RLS do worker — vem do request que enfileirou, não de lookup. */
  tenantId: string;
}

@Processor(ESTIMATES_QUEUE)
export class EstimatesWorker extends WorkerHost {
  private readonly logger = new Logger(EstimatesWorker.name);

  constructor(
    private readonly effort: EffortBreakdownService,
    private readonly prisma: PrismaService,
  ) {
    super();
  }

  async process(job: Job<EffortJobData>): Promise<void> {
    this.logger.log(
      `Estimates job ${job.id} → decomposição do projeto ${job.data.clientProjectId}`,
    );
    // A armadilha que esta frente já pagou 5 vezes, no lugar onde ela mora: fora
    // de request o RLS é fail-closed, e ler ou gravar sem contexto NÃO dá erro —
    // dá ZERO LINHAS. Uma decomposição que gravou zero tarefas tem a mesma cara
    // de uma bem-sucedida vista de fora.
    await this.prisma.runInTenantContext([job.data.tenantId], () =>
      this.effort.generate(job.data),
    );
  }
}
