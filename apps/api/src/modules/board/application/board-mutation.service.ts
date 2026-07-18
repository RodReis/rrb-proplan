import { InjectQueue } from '@nestjs/bullmq';
import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Role } from '@prisma/client';
import { Queue } from 'bullmq';
import { PrismaService } from '../../../prisma/prisma.service';
import { BoardColumn, IssuePriority } from '../domain/column-mapping';
import { BOARD_QUEUE } from '../board.constants';

// Colunas terminais: entrar nelas FECHA a issue (proplan:finalizado /
// proplan:descartado) — o ato deliberado do dono (ADR-011, CLAUDE.md). Só owner
// pode. Nenhuma automação passa por aqui (o worker não reautentica papel).
const CLOSING_COLUMNS: readonly BoardColumn[] = ['finalized', 'discarded'];

/** Uma mutação fecha a issue (exige owner)? */
export function closesIssue(input: MutationInput): boolean {
  if (input.type === 'discard_card') return true;
  if (input.type === 'move_column') return CLOSING_COLUMNS.includes(input.toColumn);
  return false;
}

// Tipos de mutação (payload por tipo). Discriminado por `type`.
export type MutationInput =
  | { type: 'move_column'; number: number; toColumn: BoardColumn }
  | { type: 'create_card'; title: string; column: BoardColumn; priority?: IssuePriority }
  | { type: 'edit_card'; number: number; title?: string; priority?: IssuePriority | null }
  | { type: 'discard_card'; number: number };

export interface BoardJobData {
  mutationId: string;
  projectId: string;
  /** Contexto RLS do worker (SPEC-022), capturado no enqueue autenticado. */
  tenantId: string;
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
    role: Role,
  ): Promise<{ mutationId: string }> {
    // Gate de papel ANTES de criar o job. Este é o único ponto síncrono com o
    // papel do usuário: depois do enqueue o job carrega só {mutationId,
    // projectId} e o worker NÃO reautentica — então fechar issue tem de ser
    // barrado aqui. Fechar (finalizado/descartado) = ato do dono (ADR-011).
    if (closesIssue(input) && role !== 'owner') {
      throw new ForbiddenException(
        'Só o owner pode finalizar ou descartar (aceite do dono, ADR-011)',
      );
    }

    const project = await this.prisma.project.findFirst({
      where: { id: projectId, userId },
      select: { id: true, installationStatus: true, tenantId: true },
    });
    if (!project) throw new NotFoundException('Projeto não encontrado');
    if (project.installationStatus !== 'active') {
      throw new NotFoundException(
        'Projeto sem instalação ativa do GitHub App — board somente leitura',
      );
    }
    if (!project.tenantId) {
      // NOT NULL no banco (Fatia 8); o tipo é nullable só pelo backfill. O
      // worker precisa dele para abrir o contexto RLS fora de request.
      throw new NotFoundException('Projeto sem tenant — sincronize o catálogo');
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
      { mutationId: mutation.id, projectId, tenantId: project.tenantId },
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
