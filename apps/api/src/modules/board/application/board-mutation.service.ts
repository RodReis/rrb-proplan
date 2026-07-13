import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, NotFoundException } from '@nestjs/common';
import { Queue } from 'bullmq';
import { PrismaService } from '../../../prisma/prisma.service';
import { BoardColumn, IssuePriority } from '../domain/column-mapping';
import { BOARD_QUEUE } from '../board.constants';

// Tipos de mutação (payload por tipo). Discriminado por `type`.
export type MutationInput =
  | { type: 'move_column'; number: number; toColumn: BoardColumn }
  | { type: 'create_card'; title: string; column: BoardColumn; priority?: IssuePriority }
  | { type: 'edit_card'; number: number; title?: string; priority?: IssuePriority | null }
  | { type: 'discard_card'; number: number };

export interface BoardJobData {
  mutationId: string;
  projectId: string;
}

/**
 * Enfileira mutações de board (SPEC-005). Cada mutação vira um BoardMutation
 * `queued` + um job na fila serializada por projeto. O status é lido por
 * polling (`queued|applying|applied|failed`) — sem webhook (ADR-009).
 */
@Injectable()
export class BoardMutationService {
  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue(BOARD_QUEUE) private readonly queue: Queue<BoardJobData>,
  ) {}

  async enqueue(
    userId: string,
    projectId: string,
    input: MutationInput,
  ): Promise<{ mutationId: string }> {
    const project = await this.prisma.project.findFirst({
      where: { id: projectId, userId },
      select: { id: true, installationStatus: true },
    });
    if (!project) throw new NotFoundException('Projeto não encontrado');
    if (project.installationStatus !== 'active') {
      throw new NotFoundException(
        'Projeto sem instalação ativa do GitHub App — board somente leitura',
      );
    }

    const mutation = await this.prisma.boardMutation.create({
      data: {
        projectId,
        type: input.type,
        payload: input as unknown as object,
        status: 'queued',
      },
    });

    // Serialização por projeto: mesmo `group` (BullMQ) OU jobId ordenado.
    // Usamos a fila FIFO padrão com concorrência 1 no worker → ordem garantida.
    await this.queue.add(
      'mutation',
      { mutationId: mutation.id, projectId },
      { attempts: 1, removeOnComplete: 200, removeOnFail: 200 },
    );

    return { mutationId: mutation.id };
  }

  async status(userId: string, projectId: string, mutationId: string) {
    const project = await this.prisma.project.findFirst({
      where: { id: projectId, userId },
      select: { id: true },
    });
    if (!project) throw new NotFoundException('Projeto não encontrado');
    const mutation = await this.prisma.boardMutation.findFirst({
      where: { id: mutationId, projectId },
      select: { id: true, status: true, error: true, type: true, finishedAt: true },
    });
    if (!mutation) throw new NotFoundException('Mutação não encontrada');
    return mutation;
  }
}
