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
import { ActivityItem, buildFeed } from '../domain/activity-feed';

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
 * Interface pública do módulo `activity` (SPEC-010). Os 3 fluxos que congelam
 * (promote, mapping, bootstrap) — em board e insight — criam uma Operation e
 * avançam seus passos por aqui. O front faz polling por id. O board_mutation
 * ficou de fora de propósito (Kanban já é otimista — ver operation-steps.ts).
 *
 * O estado mora no banco (não na tela): F5 no meio da operação volta mostrando
 * o passo atual. A Operation NÃO é fonte do histórico — o histórico (feed) é
 * projeção de leitura sobre Operation+Insight+BoardMutation+SyncRun, sem tabela
 * duplicada (ADR-017 aplicado internamente).
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

  /** Operações em curso (seção "Agora" do painel). Valida o dono. */
  async running(userId: string, projectId: string): Promise<OperationView[]> {
    await this.assertOwner(userId, projectId);
    const ops = await this.prisma.operation.findMany({
      where: { projectId, status: 'running' },
      orderBy: { startedAt: 'desc' },
    });
    // Deriva a conclusão de cada uma (mesma regra do get) para não mostrar como
    // "em curso" algo cujo SyncRun já terminou.
    return Promise.all(ops.map((o) => this.get(userId, o.id)));
  }

  /**
   * Histórico do painel (seção "Histórico"): projeção de leitura sobre as 4
   * fontes, ordem reversa, paginada por cursor (timestamp ISO). `includeSyncs`
   * revela os SyncRun (inclusive `noop`) — por padrão ficam ocultos para o feed
   * não encher de "nada mudou". Não duplica evento (ADR-017).
   */
  async feed(
    userId: string,
    projectId: string,
    opts: { cursor?: string; includeSyncs?: boolean; limit?: number } = {},
  ): Promise<{ items: ActivityItem[]; nextCursor: string | null }> {
    const project = await this.assertOwner(userId, projectId);
    const limit = Math.min(opts.limit ?? 30, 100);
    const before = opts.cursor ? new Date(opts.cursor) : undefined;
    const take = limit + 1; // por fonte: o suficiente para preencher a página

    const [operations, insightRuns, mutations, syncs] = await Promise.all([
      this.prisma.operation.findMany({
        where: { projectId, ...(before ? { startedAt: { lt: before } } : {}) },
        orderBy: { startedAt: 'desc' },
        take,
        select: { id: true, kind: true, status: true, commitUrl: true, startedAt: true },
      }),
      // Fonte do feed para IA (SPEC-011): InsightRun — uma linha por execução,
      // distingue gerado × reaproveitado (a economia da 7.7 fica visível). Antes
      // era a tabela Insight (o artefato); trocada para não duplicar o fato "gerou".
      this.prisma.insightRun.findMany({
        where: { projectId, ...(before ? { createdAt: { lt: before } } : {}) },
        orderBy: { createdAt: 'desc' },
        take,
        select: { id: true, kind: true, outcome: true, createdAt: true },
      }),
      this.prisma.boardMutation.findMany({
        where: { projectId, ...(before ? { createdAt: { lt: before } } : {}) },
        orderBy: { createdAt: 'desc' },
        take,
        select: { id: true, type: true, payload: true, status: true, createdAt: true },
      }),
      opts.includeSyncs
        ? this.prisma.syncRun.findMany({
            where: { projectId, ...(before ? { startedAt: { lt: before } } : {}) },
            orderBy: { startedAt: 'desc' },
            take,
            select: { id: true, status: true, added: true, updated: true, removed: true, startedAt: true },
          })
        : Promise.resolve([]),
    ]);

    const issueUrl = (number?: number) =>
      number ? `https://github.com/${project.owner}/${project.name}/issues/${number}` : null;

    const all = buildFeed({
      operations,
      insightRuns,
      mutations: mutations.map((m) => ({
        ...m,
        issueUrl: issueUrl((m.payload as { number?: number } | null)?.number),
      })),
      syncs,
    });

    const page = all.slice(0, limit);
    const nextCursor = all.length > limit ? page[page.length - 1].at : null;
    return { items: page, nextCursor };
  }

  private async assertOwner(userId: string, projectId: string) {
    const project = await this.prisma.project.findFirst({
      where: { id: projectId, userId },
      select: { id: true, owner: true, name: true },
    });
    if (!project) throw new NotFoundException('Projeto não encontrado');
    return project;
  }
}
