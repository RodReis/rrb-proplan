import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import type { ArtifactsJobData } from '../infrastructure/artifacts.worker';

/**
 * Orquestrador do pipeline (SPEC-032 §2.2).
 *
 * **Escopo do PR-2**: carregar a versão do briefing, validar os dados mínimos e
 * abrir o `ArtifactRun`. As 4 capacidades geradoras e o revisor chegam no PR-3
 * — o run fecha aqui como `COMPLETED` sem artefato nenhum, que é o estado
 * honesto de "o gatilho funciona, a geração ainda não existe".
 *
 * Roda **sempre** dentro de `runInTenantContext` (aberto pelo worker): nenhuma
 * query daqui pode presumir contexto de request, porque não há request.
 */
@Injectable()
export class ArtifactsService {
  private readonly logger = new Logger(ArtifactsService.name);

  constructor(private readonly prisma: PrismaService) {}

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

    // PR-3 entra aqui: executar `CAPABILITY_ORDER` em sequência, verificando o
    // teto antes de CADA capacidade (§2.6) e gravando artefato + versão a cada
    // uma. Enquanto isso não existe, o run fecha vazio — e `completedKinds: []`
    // diz a verdade sobre o que rodou.
    await this.prisma.artifactRun.update({
      where: { id: run.id },
      data: { status: 'COMPLETED', finishedAt: new Date() },
    });
  }
}
