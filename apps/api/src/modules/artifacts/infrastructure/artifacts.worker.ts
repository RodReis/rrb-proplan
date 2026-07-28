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
    private readonly prisma: PrismaService,
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

    const tentativa = await this.proximaTentativa(
      event.briefingVersionId,
      event.tenantId,
    );

    this.logger.log(
      `BriefingSubmitted → enfileira pipeline do briefing ${event.briefingVersionId} (tentativa ${tentativa})`,
    );
    await this.queue.add('pipeline', data, {
      // `jobId` por (briefing, TENTATIVA). O BullMQ recusa id repetido enquanto
      // o job existir na fila — é a 1ª barreira de idempotência (§2.8), barata e
      // antes de qualquer gasto.
      //
      // **A tentativa entra na chave por causa de um achado do dogfooding**: com
      // o id fixo em `briefing_<id>`, o job de um run que FALHOU continuava em
      // `completed` no Redis (`removeOnComplete: 50`), e o `add` seguinte era
      // **descartado em silêncio** — nada no log, nada no banco. Um briefing
      // cujo pipeline falhou ficava sem gatilho até o job sair da retenção.
      //
      // O que se perde: a barreira da fila deixa de valer ENTRE tentativas. O
      // que continua protegendo é a do banco — `runPipeline` recusa abrir um 2º
      // run quando já existe um `RUNNING` ou `COMPLETED` para o mesmo briefing,
      // e essa vale mesmo depois de o job sumir da fila. Um evento reentregue
      // ainda produz um job a mais, mas ele para na 1ª query e não gasta nada.
      jobId: `briefing_${event.briefingVersionId}_${tentativa}`,
      // UMA retentativa (decisão 6 do PI, §8): cobre o 429 passageiro. A
      // segunda já seria gastar de novo numa falha que pode ser estrutural, e
      // aí a decisão volta a ser humana — o botão de regenerar (PR-4).
      attempts: 2,
      backoff: { type: 'exponential', delay: 5000 },
      removeOnComplete: 50,
      removeOnFail: 50,
    });
  }

  /**
   * Quantas execuções já houve para este briefing, + 1.
   *
   * Conta **todos** os runs, inclusive os `FAILED` — é justamente o run que
   * falhou que precisa produzir uma chave nova. Roda no contexto do tenant
   * porque o listener também não tem request: sem isso o RLS devolveria zero e
   * a chave voltaria a colidir, que é o bug de origem com outra causa.
   *
   * Falha na contagem não impede o enfileiramento: cai em `Date.now()`, que
   * garante chave única ao custo de perder a numeração legível. Barrar o
   * pipeline porque a query de um detalhe de fila falhou seria trocar um
   * problema pequeno por um grande.
   */
  private async proximaTentativa(
    briefingVersionId: string,
    tenantId: string,
  ): Promise<number> {
    try {
      const total = await this.prisma.runInTenantContext([tenantId], () =>
        this.prisma.artifactRun.count({ where: { briefingVersionId } }),
      );
      return total + 1;
    } catch (err) {
      this.logger.warn(
        `Não consegui contar as execuções de ${briefingVersionId}: ${err instanceof Error ? err.message : err}`,
      );
      return Date.now();
    }
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
