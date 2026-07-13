import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { Job, Queue } from 'bullmq';
import { PrismaService } from '../../../prisma/prisma.service';
import { MutationApplierService } from '../application/mutation-applier.service';
import { ProjectionService } from '../application/projection.service';
import { MutationInput } from '../application/board-mutation.service';
import { BOARD_QUEUE } from '../board.constants';

// Debounce da projeção: janela curta para coalescer várias mutações num commit.
const PROJECTION_DEBOUNCE_MS = 4000;

type BoardJob =
  | { kind: 'mutation'; mutationId: string; projectId: string }
  | { kind: 'projection'; projectId: string };

/**
 * Worker do board (SPEC-005). Concorrência 1 → serializa por processo (uma
 * mutação por vez, ordem FIFO). Aplica a mutação (installation token), marca
 * `applied`, e agenda a projeção com debounce (5 cards = 1 commit).
 */
@Processor(BOARD_QUEUE, { concurrency: 1 })
@Injectable()
export class BoardWorker extends WorkerHost {
  private readonly logger = new Logger(BoardWorker.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly applier: MutationApplierService,
    private readonly projection: ProjectionService,
    @InjectQueue(BOARD_QUEUE) private readonly queue: Queue<BoardJob>,
  ) {
    super();
  }

  async process(job: Job<BoardJob>): Promise<void> {
    const data = job.data;
    if (job.name === 'projection' || data.kind === 'projection') {
      await this.runProjection(data.projectId);
      return;
    }
    await this.runMutation(data.mutationId, data.projectId);
  }

  private async runMutation(mutationId: string, projectId: string): Promise<void> {
    const mutation = await this.prisma.boardMutation.findUnique({
      where: { id: mutationId },
    });
    if (!mutation) return;

    await this.prisma.boardMutation.update({
      where: { id: mutationId },
      data: { status: 'applying' },
    });

    try {
      await this.applier.apply(projectId, mutation.payload as unknown as MutationInput);
      await this.prisma.boardMutation.update({
        where: { id: mutationId },
        data: { status: 'applied', finishedAt: new Date() },
      });
      // Projeção é consequência: agenda com debounce e NÃO bloqueia o card.
      await this.scheduleProjection(projectId);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`Mutação ${mutationId} falhou: ${message}`);
      await this.prisma.boardMutation.update({
        where: { id: mutationId },
        data: { status: 'failed', error: message, finishedAt: new Date() },
      });
      throw err;
    }
  }

  /**
   * Agenda a projeção com debounce por projeto: jobId fixo por projeto +
   * `delay`. BullMQ ignora um add com jobId já existente, então a 1ª mutação
   * agenda o commit para daqui a PROJECTION_DEBOUNCE_MS e as próximas dentro da
   * janela são coalescidas — 5 cards arrastados = 1 commit. A projeção lê o
   * cache no momento em que roda, então já reflete todas as mutações da janela.
   * ponytail: debounce leading-edge simples; se quiser trailing (resetar o timer
   * a cada mutação) seria preciso remover+readd o job — desnecessário aqui.
   */
  private async scheduleProjection(projectId: string): Promise<void> {
    await this.queue.add(
      'projection',
      { kind: 'projection', projectId },
      {
        jobId: `projection_${projectId}`,
        delay: PROJECTION_DEBOUNCE_MS,
        removeOnComplete: true,
        removeOnFail: true,
      },
    );
  }

  private async runProjection(projectId: string): Promise<void> {
    const updated = new Date().toISOString().slice(0, 10);
    const ok = await this.projection.commitProjection(projectId, updated);
    if (!ok) {
      this.logger.warn(
        `Projeção do projeto ${projectId} não commitada — próximo sync reconcilia`,
      );
    }
  }
}
