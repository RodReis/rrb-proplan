import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import {
  LlmClientFactory,
  LlmUsageRecorder,
  UsageService,
  type LlmRequest,
} from '../../llm';
import { ARTIFACTS_MODEL } from '../artifacts.config';
import type { ArtifactKind } from '../domain/artifact-kind';
import {
  CAPABILITIES,
  buildUserMessage,
  type Capability,
} from '../domain/capabilities';
import { inputHashOf } from '../domain/input-hash';
import type { ArtifactsJobData } from '../infrastructure/artifacts.worker';

/** Motivo de parada, em português — vai para `ArtifactRun.failureReason` e à tela. */
const MOTIVO_TETO = 'Teto de gasto de IA do tenant atingido durante a geração.';

@Injectable()
export class ArtifactsService {
  private readonly logger = new Logger(ArtifactsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly llmFactory: LlmClientFactory,
    private readonly recorder: LlmUsageRecorder,
    private readonly usageGate: UsageService,
  ) {}

  /**
   * Orquestrador do pipeline (SPEC-032 §2.2).
   *
   * Roda **sempre** dentro de `runInTenantContext` (aberto pelo worker):
   * nenhuma query daqui pode presumir contexto de request, porque não há
   * request.
   */
  async runPipeline(data: ArtifactsJobData): Promise<void> {
    const briefing = await this.prisma.briefingVersion.findUnique({
      where: { id: data.briefingVersionId },
      select: { id: true, clientProjectId: true, answers: true },
    });

    // Sob RLS fail-closed, "não existe" e "existe em outro tenant" são a mesma
    // resposta — e é isso que se quer. O que NÃO se pode fazer é seguir em
    // frente: um pipeline que roda sobre briefing inexistente gravaria run
    // órfão e artefato vazio.
    if (!briefing) {
      this.logger.warn(
        `Briefing ${data.briefingVersionId} não encontrado no tenant ${data.tenantId} — pipeline abortado`,
      );
      return;
    }

    // O evento traz `clientProjectId` e o briefing também. Divergir significa
    // evento corrompido ou briefing movido de projeto — nenhum dos dois deve
    // gerar artefato pendurado no projeto errado.
    if (briefing.clientProjectId !== data.clientProjectId) {
      this.logger.error(
        `Briefing ${briefing.id} pertence ao projeto ${briefing.clientProjectId}, ` +
          `mas o job veio com ${data.clientProjectId} — pipeline abortado`,
      );
      return;
    }

    // Idempotência do gatilho (§2.8), 2ª barreira: o `jobId` da fila some com o
    // `removeOnComplete`, então um evento reentregue depois disso passaria por
    // ele. Aqui a checagem é contra o BANCO, que não esquece.
    const jaRodou = await this.prisma.artifactRun.findFirst({
      where: {
        briefingVersionId: briefing.id,
        status: { in: ['RUNNING', 'COMPLETED'] },
      },
      select: { id: true, status: true },
    });
    if (jaRodou) {
      this.logger.log(
        `Briefing ${briefing.id} já tem run ${jaRodou.id} (${jaRodou.status}) — nada a fazer`,
      );
      return;
    }

    const run = await this.prisma.artifactRun.create({
      data: {
        tenantId: data.tenantId,
        clientProjectId: data.clientProjectId,
        briefingVersionId: briefing.id,
        status: 'RUNNING',
        completedKinds: [],
      },
      select: { id: true },
    });

    this.logger.log(`Run ${run.id} aberto para o briefing ${briefing.id}`);
    await this.executarCapacidades(run.id, data, briefing.answers);
  }

  /**
   * Executa as 4 capacidades **em sequência** (§2.3), cada uma consumindo a
   * saída das anteriores.
   *
   * Sequencial e não paralelo porque a dependência é real: o `scope` lê o
   * `normalize`, o `requirements` lê o `scope`. Paralelizar produziria um
   * `scope` que ignora a normalização — plausível e errado.
   */
  private async executarCapacidades(
    runId: string,
    data: ArtifactsJobData,
    answers: Prisma.JsonValue,
  ): Promise<void> {
    const upstream: Partial<Record<ArtifactKind, unknown>> = {};
    const concluidas: ArtifactKind[] = [];

    for (const cap of CAPABILITIES) {
      // Teto verificado ANTES DE CADA capacidade (§2.6), não só no gatilho: o
      // pipeline são 4 chamadas, e o teto pode estourar na 2ª por gasto de
      // outro caminho. Checar só na entrada deixaria o run gastar as quatro.
      if (!(await this.usageGate.canSpendForTenant(data.tenantId))) {
        this.logger.warn(
          `Teto do tenant ${data.tenantId} estourou antes de "${cap.kind}" — run ${runId} parado`,
        );
        // Decisão 4 do PI (§8): guarda o PARCIAL como FAILED. Os artefatos já
        // gerados continuam visíveis e aprováveis — jogar fora o trabalho pago
        // porque o 3º passo não coube seria queimar dinheiro duas vezes.
        await this.fecharRun(runId, 'FAILED', concluidas, MOTIVO_TETO);
        return;
      }

      try {
        const conteudo = await this.gerar(cap, runId, data, answers, upstream);
        upstream[cap.kind] = conteudo;
        concluidas.push(cap.kind);
      } catch (err) {
        const motivo = err instanceof Error ? err.message : String(err);
        this.logger.warn(`Capacidade "${cap.kind}" falhou no run ${runId}: ${motivo}`);
        // Falha explícita, com motivo legível (§2.5). O que NÃO se faz é seguir
        // para a próxima capacidade: ela consome esta saída, e gerar o `scope`
        // sem `normalize` produziria artefato construído sobre um buraco.
        await this.fecharRun(runId, 'FAILED', concluidas, motivo);
        return;
      }
    }

    await this.fecharRun(runId, 'COMPLETED', concluidas, null);
    this.logger.log(`Run ${runId} concluído com ${concluidas.length} artefatos`);
  }

  /**
   * Uma capacidade: chama o modelo, valida contra o schema e grava artefato +
   * versão. Lança em falha — quem trata é `executarCapacidades`.
   */
  private async gerar(
    cap: Capability,
    runId: string,
    data: ArtifactsJobData,
    answers: Prisma.JsonValue,
    upstream: Partial<Record<ArtifactKind, unknown>>,
  ): Promise<unknown> {
    const inputHash = inputHashOf({
      kind: cap.kind,
      promptVersion: cap.promptVersion,
      answers,
      upstream,
    });

    const artifact = await this.prisma.artifact.upsert({
      where: {
        clientProjectId_kind: { clientProjectId: data.clientProjectId, kind: cap.kind },
      },
      // `upsert` e não `create`: o artefato pode já existir de um run anterior
      // que falhou depois dele. Recriar estouraria o UNIQUE (clientProjectId,
      // kind) e transformaria "tentar de novo" em erro.
      create: {
        tenantId: data.tenantId,
        clientProjectId: data.clientProjectId,
        kind: cap.kind,
        state: 'PENDING_REVIEW',
      },
      update: {},
      select: { id: true },
    });

    const client = this.llmFactory.create('anthropic');
    const req: LlmRequest = {
      system: cap.system,
      user: buildUserMessage(cap, answers, upstream),
      maxTokens: cap.maxTokens,
      // Modelo único da frente (§2.4), não o global do insight.
      model: ARTIFACTS_MODEL,
    };

    // `runParsed` faz o retry de schema inválido e grava UMA LINHA POR
    // TENTATIVA no ledger (§5: "inclusive as que falharam e os retries
    // descartados"). `tenantId` explícito porque este caminho não tem
    // `projectId` — o pipeline nasce de `ClientProject`, outro domínio.
    const conteudo = await this.recorder.runParsed(
      client,
      req,
      {
        projectId: null,
        tenantId: data.tenantId,
        artifactRunId: runId,
        kind: `artifact_${cap.kind}`,
        inputHash,
      },
      (text) => cap.parse(text),
    );

    const version = await this.prisma.artifactVersion.create({
      data: {
        tenantId: data.tenantId,
        artifactId: artifact.id,
        version: await this.proximaVersao(artifact.id),
        content: conteudo as Prisma.InputJsonValue,
        author: 'ai',
        inputHash,
        promptVersion: cap.promptVersion,
        model: ARTIFACTS_MODEL,
        artifactRunId: runId,
      },
      select: { id: true },
    });

    await this.prisma.artifact.update({
      where: { id: artifact.id },
      data: { currentVersionId: version.id, state: 'PENDING_REVIEW' },
    });

    return conteudo;
  }

  /** Sequencial por artefato — v1, v2..., como `BriefingVersion.version`. */
  private async proximaVersao(artifactId: string): Promise<number> {
    const ultima = await this.prisma.artifactVersion.findFirst({
      where: { artifactId },
      orderBy: { version: 'desc' },
      select: { version: true },
    });
    return (ultima?.version ?? 0) + 1;
  }

  private async fecharRun(
    runId: string,
    status: 'COMPLETED' | 'FAILED',
    concluidas: ArtifactKind[],
    motivo: string | null,
  ): Promise<void> {
    await this.prisma.artifactRun.update({
      where: { id: runId },
      data: {
        status,
        completedKinds: concluidas,
        failureReason: motivo,
        finishedAt: new Date(),
      },
    });
  }
}
