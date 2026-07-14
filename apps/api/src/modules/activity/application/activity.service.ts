import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import {
  advanceTo,
  buildSteps,
  markAllDone,
  markFailed,
  OperationKind,
  Step,
} from '../domain/operation-steps';

export interface OperationView {
  id: string;
  kind: OperationKind;
  status: 'running' | 'done' | 'failed';
  steps: Step[];
  commitUrl: string | null;
  syncRunId: string | null;
  error: string | null;
  startedAt: Date;
  finishedAt: Date | null;
}

/**
 * Interface pública do módulo `activity` (SPEC-010). Os 4 fluxos de escrita
 * (promote, mapping, bootstrap, board_mutation) — em board e insight — criam
 * uma Operation e avançam seus passos por aqui. O front faz polling por id.
 *
 * O estado mora no banco (não na tela): F5 no meio da operação volta mostrando
 * o passo atual. NÃO é fonte do histórico — o histórico é projeção sobre
 * SyncRun/Insight/BoardMutation (ADR-017 aplicado internamente).
 */
@Injectable()
export class ActivityService {
  constructor(private readonly prisma: PrismaService) {}

  /** Cria a operação com os passos iniciais e marca o 1º como `running`. */
  async start(
    projectId: string,
    kind: OperationKind,
    doc?: string,
  ): Promise<string> {
    const steps = buildSteps(kind, doc);
    const first = steps[0]?.key;
    const initial = first ? advanceTo(steps, first) : steps;
    const op = await this.prisma.operation.create({
      data: { projectId, kind, status: 'running', steps: initial as unknown as Prisma.InputJsonValue },
    });
    return op.id;
  }

  /** Avança para o passo `stepKey` (anteriores viram `done`). */
  async advance(operationId: string, stepKey: string): Promise<void> {
    const op = await this.prisma.operation.findUnique({ where: { id: operationId } });
    if (!op) return; // operação some se o projeto foi apagado — não quebra o fluxo
    const steps = advanceTo(op.steps as unknown as Step[], stepKey);
    await this.prisma.operation.update({
      where: { id: operationId },
      data: { steps: steps as unknown as Prisma.InputJsonValue },
    });
  }

  /** Registra os artefatos produzidos (URL do commit, syncRunId) sem finalizar. */
  async attachArtifacts(
    operationId: string,
    artifacts: { commitUrl?: string; syncRunId?: string },
  ): Promise<void> {
    await this.prisma.operation.update({
      where: { id: operationId },
      data: {
        ...(artifacts.commitUrl ? { commitUrl: artifacts.commitUrl } : {}),
        ...(artifacts.syncRunId ? { syncRunId: artifacts.syncRunId } : {}),
      },
    });
  }

  /** Conclui: todos os passos `done`, status `done`. */
  async finish(operationId: string): Promise<void> {
    const op = await this.prisma.operation.findUnique({ where: { id: operationId } });
    if (!op) return;
    await this.prisma.operation.update({
      where: { id: operationId },
      data: {
        status: 'done',
        steps: markAllDone(op.steps as unknown as Step[]) as unknown as Prisma.InputJsonValue,
        finishedAt: new Date(),
      },
    });
  }

  /** Falha: o passo em curso vira `failed`, status `failed`, com o motivo. */
  async fail(operationId: string, error: string): Promise<void> {
    const op = await this.prisma.operation.findUnique({ where: { id: operationId } });
    if (!op) return;
    await this.prisma.operation.update({
      where: { id: operationId },
      data: {
        status: 'failed',
        steps: markFailed(op.steps as unknown as Step[]) as unknown as Prisma.InputJsonValue,
        error,
        finishedAt: new Date(),
      },
    });
  }

  /**
   * Estado atual da operação (para o polling do front). Valida o dono.
   *
   * Se a operação está `running` e depende de um sync (tem `syncRunId`), o
   * status final é DERIVADO do SyncRun ao ler — o worker de sync roda no
   * BullMQ, desacoplado; em vez de acoplar o worker a este módulo, a operação
   * se conclui de forma preguiçosa quando o sync que ela disparou termina.
   * SyncRun `failed` → operação falha; `success`/`noop` → operação conclui.
   */
  async get(userId: string, operationId: string): Promise<OperationView> {
    const op = await this.prisma.operation.findFirst({
      where: { id: operationId, project: { userId } },
    });
    if (!op) throw new NotFoundException('Operação não encontrada');

    if (op.status === 'running' && op.syncRunId) {
      const run = await this.prisma.syncRun.findUnique({
        where: { id: op.syncRunId },
        select: { status: true, error: true },
      });
      if (run && (run.status === 'success' || run.status === 'noop')) {
        await this.finish(op.id);
        return this.get(userId, operationId);
      }
      if (run && run.status === 'failed') {
        await this.fail(op.id, run.error ?? 'Sincronização falhou');
        return this.get(userId, operationId);
      }
    }

    return {
      id: op.id,
      kind: op.kind as OperationKind,
      status: op.status as OperationView['status'],
      steps: op.steps as unknown as Step[],
      commitUrl: op.commitUrl,
      syncRunId: op.syncRunId,
      error: op.error,
      startedAt: op.startedAt,
      finishedAt: op.finishedAt,
    };
  }
}
