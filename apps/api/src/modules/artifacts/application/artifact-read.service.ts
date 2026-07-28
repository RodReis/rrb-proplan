import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { ARTIFACT_KINDS, REQUIRED_ARTIFACT_COUNT } from '../domain/artifact-kind';

/**
 * Leitura dos artefatos no painel (SPEC-032 §2.12).
 *
 * Só `GET`. Nada aqui altera estado — aprovar, rejeitar e editar vivem no
 * `ArtifactReviewService`, e a separação é o que torna trivial provar que a
 * leitura não escreve.
 */
@Injectable()
export class ArtifactReadService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Estado dos 4 artefatos do projeto + o run mais recente.
   *
   * Devolve os 4 `kinds` **sempre**, mesmo os que não existem ainda: ausência é
   * informação (ADR-014), e uma lista curta faria a tela mostrar 2 cartões sem
   * dizer que faltam 2. Quem não rodou vem com `state: null`.
   */
  async byClientProject(tenantId: string, clientProjectId: string) {
    const projeto = await this.prisma.clientProject.findFirst({
      where: { id: clientProjectId, client: { tenantId } },
      select: { id: true },
    });
    if (!projeto) throw new NotFoundException('Projeto não encontrado');

    const artifacts = await this.prisma.artifact.findMany({
      where: { clientProjectId, tenantId },
      select: {
        id: true,
        kind: true,
        state: true,
        currentVersionId: true,
        rejectionReason: true,
        reviewedAt: true,
        reviewedBy: true,
        versions: {
          orderBy: { version: 'desc' },
          select: {
            id: true,
            version: true,
            author: true,
            model: true,
            promptVersion: true,
            editedBy: true,
            parentVersionId: true,
            createdAt: true,
          },
        },
      },
    });

    const porKind = new Map(artifacts.map((a) => [a.kind, a]));

    const run = await this.prisma.artifactRun.findFirst({
      where: { clientProjectId, tenantId },
      orderBy: { startedAt: 'desc' },
      select: {
        id: true,
        status: true,
        completedKinds: true,
        failureReason: true,
        startedAt: true,
        finishedAt: true,
      },
    });

    const aprovados = artifacts.filter((a) => a.state === 'APPROVED').length;

    return {
      artifacts: ARTIFACT_KINDS.map((kind) => {
        const a = porKind.get(kind);
        // `state: null` é diferente de `FAILED`: um não rodou, o outro tentou e
        // falhou. Colapsar os dois faria "ainda não usei" parecer "usei e deu
        // errado" (MVP3 §9).
        if (!a) return { kind, state: null, versions: [] };
        return { ...a, versions: a.versions };
      }),
      run,
      approvedCount: aprovados,
      requiredCount: REQUIRED_ARTIFACT_COUNT,
      /** Quanto custou este briefing — do LEDGER, nunca derivado das versões. */
      costUsd: run ? await this.custoDoRun(run.id) : null,
    };
  }

  /** Conteúdo de uma versão, com o parecer do revisor ao lado. */
  async version(tenantId: string, versionId: string) {
    const version = await this.prisma.artifactVersion.findFirst({
      where: { id: versionId, tenantId },
      select: {
        id: true,
        version: true,
        content: true,
        author: true,
        model: true,
        promptVersion: true,
        editedBy: true,
        parentVersionId: true,
        createdAt: true,
        artifact: { select: { id: true, kind: true, state: true } },
        verdicts: {
          orderBy: { createdAt: 'desc' },
          select: { verdict: true, rationale: true, model: true, createdAt: true },
        },
      },
    });
    if (!version) throw new NotFoundException('Versão não encontrada');
    return version;
  }

  /**
   * Soma o gasto do run **consultando o ledger** (§5) — nunca derivando de
   * `ArtifactVersion`, que é o que o ADR-016 proíbe: o ledger é a fonte, o
   * artefato é o produto.
   */
  private async custoDoRun(runId: string): Promise<string | null> {
    const agg = await this.prisma.llmUsage.aggregate({
      where: { artifactRunId: runId },
      _sum: { costUsd: true },
    });
    return agg._sum.costUsd?.toString() ?? null;
  }
}
