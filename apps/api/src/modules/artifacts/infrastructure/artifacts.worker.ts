import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { Job, Queue } from 'bullmq';
import { PrismaService } from '../../../prisma/prisma.service';
import {
  BRIEFING_SUBMITTED,
  type BriefingSubmittedEvent,
} from '../../briefing/application/briefing-submit.service';
import { UsageService } from '../../llm';
import { ArtifactsService } from '../application/artifacts.service';
import { ARTIFACTS_QUEUE } from '../artifacts.constants';

export interface ArtifactsJobData {
  clientProjectId: string;
  briefingVersionId: string;
  /** Contexto RLS do worker (§7.3) — vem do evento, não de lookup. */
  tenantId: string;
}

/**
 * Consumidor do `BriefingSubmitted` (SPEC-032 §2.1).
 *
 * O evento é in-process e **já foi emitido depois do commit** do submit, então
 * aqui o briefing existe. O que este listener faz é só decidir se o pipeline
 * pode rodar e enfileirar — **nada de IA no caminho da request** (ADR-002):
 * quem envia o briefing recebe o 201 sem esperar geração nenhuma.
 */
@Injectable()
export class ArtifactsEventListener {
  private readonly logger = new Logger(ArtifactsEventListener.name);

  constructor(
    @InjectQueue(ARTIFACTS_QUEUE) private readonly queue: Queue<ArtifactsJobData>,
    private readonly usage: UsageService,
  ) {}

  @OnEvent(BRIEFING_SUBMITTED)
  async onBriefingSubmitted(event: BriefingSubmittedEvent): Promise<void> {
    // Gate do teto ANTES de enfileirar (§2.6). O caminho é anônimo — o briefing
    // vem de um cliente sem sessão — então quem responde é `canSpendForTenant`,
    // não `canSpend(projectId)`: é exatamente para este chamador que o ADR-026
    // existe.
    if (!(await this.usage.canSpendForTenant(event.tenantId))) {
      // O briefing continua íntegro (§5): não enfileirar não desfaz nada. O
      // painel dirá por quê — a leitura chega no PR-5.
      this.logger.warn(
        `Teto de gasto do tenant ${event.tenantId} atingido — pipeline do briefing ` +
          `${event.briefingVersionId} NÃO enfileirado`,
      );
      return;
    }

    const data: ArtifactsJobData = {
      clientProjectId: event.clientProjectId,
      briefingVersionId: event.briefingVersionId,
      tenantId: event.tenantId,
    };

    this.logger.log(
      `BriefingSubmitted → enfileira pipeline do briefing ${event.briefingVersionId}`,
    );
    await this.queue.add('pipeline', data, {
      // `jobId` pela versão do briefing: o BullMQ recusa um job com id repetido
      // enquanto ele existir na fila. É a PRIMEIRA barreira de idempotência
      // (§2.8) — barata e antes de qualquer gasto. A segunda é o `inputHash` no
      // banco, que vale mesmo depois de o job ter sido removido da fila
      // (`removeOnComplete`), e é a que realmente garante a regra.
      jobId: `briefing_${event.briefingVersionId}`,
      // UMA retentativa (decisão 6 do PI, §8): cobre o 429 passageiro. A
      // segunda já seria gastar de novo numa falha que pode ser estrutural, e
      // aí a decisão volta a ser humana — o botão de regenerar (PR-4).
      attempts: 2,
      backoff: { type: 'exponential', delay: 5000 },
      removeOnComplete: 50,
      removeOnFail: 50,
    });
  }
}

@Processor(ARTIFACTS_QUEUE)
export class ArtifactsWorker extends WorkerHost {
  private readonly logger = new Logger(ArtifactsWorker.name);

  constructor(
    private readonly artifacts: ArtifactsService,
    private readonly prisma: PrismaService,
  ) {
    super();
  }

  async process(job: Job<ArtifactsJobData>): Promise<void> {
    this.logger.log(
      `Artifacts job ${job.id} → briefing ${job.data.briefingVersionId}`,
    );
    // A armadilha que o PR-1 deixou cobrada, no lugar onde ela mora: fora de
    // request o RLS é fail-closed, e ler ou gravar sem contexto NÃO dá erro —
    // dá ZERO LINHAS. Um pipeline que gravou zero artefatos tem a mesma cara de
    // um bem-sucedido visto de fora. 5 ocorrências desta classe nesta frente,
    // duas encontradas só no dogfooding, todas com a suíte verde.
    await this.prisma.runInTenantContext([job.data.tenantId], () =>
      this.artifacts.runPipeline(job.data),
    );
  }
}
