import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, NotFoundException } from '@nestjs/common';
import { Queue } from 'bullmq';
import { PrismaService } from '../../../prisma/prisma.service';
import { SYNC_QUEUE } from '../ingestion.constants';

export interface SyncJobData {
  syncRunId: string;
}

/**
 * Interface pública do módulo ingestion (SPEC-002). Outros módulos
 * (catalog dispara, insight futuro consome) chamam `enqueueSync`.
 */
@Injectable()
export class IngestionService {
  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue(SYNC_QUEUE) private readonly syncQueue: Queue<SyncJobData>,
  ) {}

  /**
   * Enfileira um sync do projeto. Cria o SyncRun `queued` e joga na fila.
   * jobId por (projectId) coalescente: dois enqueues próximos não empilham
   * dois runs enquanto um está pendente — reforça a idempotência por hash.
   */
  async enqueueSync(projectId: string): Promise<{ syncRunId: string }> {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
    });
    if (!project) throw new NotFoundException('Projeto não encontrado');

    const run = await this.prisma.syncRun.create({
      data: { projectId, status: 'queued' },
    });

    await this.syncQueue.add(
      'sync',
      { syncRunId: run.id },
      {
        attempts: 3,
        backoff: { type: 'exponential', delay: 2000 },
        removeOnComplete: 100,
        removeOnFail: 100,
      },
    );

    return { syncRunId: run.id };
  }

  async latestSyncRun(userId: string, projectId: string) {
    await this.assertOwner(userId, projectId);
    return this.prisma.syncRun.findFirst({
      where: { projectId },
      orderBy: { startedAt: 'desc' },
    });
  }

  async listDocuments(userId: string, projectId: string) {
    await this.assertOwner(userId, projectId);
    return this.prisma.document.findMany({
      where: { projectId },
      select: {
        id: true,
        path: true,
        isConventional: true,
        byteSize: true,
        updatedAt: true,
      },
      orderBy: { path: 'asc' },
    });
  }

  async documentContent(userId: string, projectId: string, path: string) {
    await this.assertOwner(userId, projectId);
    const doc = await this.prisma.document.findUnique({
      where: { projectId_path: { projectId, path } },
    });
    if (!doc) throw new NotFoundException('Documento não encontrado');
    return doc;
  }

  /** Garante que o projeto pertence ao usuário (isolamento por dono). */
  private async assertOwner(userId: string, projectId: string): Promise<void> {
    const project = await this.prisma.project.findFirst({
      where: { id: projectId, userId },
      select: { id: true },
    });
    if (!project) throw new NotFoundException('Projeto não encontrado');
  }
}
