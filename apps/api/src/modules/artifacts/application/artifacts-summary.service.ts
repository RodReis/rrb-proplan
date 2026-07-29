import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';

export interface PendingArtifact {
  artifactId: string;
  clientProjectId: string;
  title: string;
  kind: string;
  since: string;
}

/**
 * A superfície que o `dashboard` consome do `artifacts` (SPEC-035 §6).
 *
 * O `ArtifactReadService` responde *"como está o projeto X"*; o dashboard
 * pergunta *"o que no tenant inteiro espera revisão"*. Pergunta diferente,
 * método próprio — e o agregador não toca `prisma.artifact` direto (ADR-001,
 * provado pelo `dashboard.arch.spec.ts`).
 *
 * Só leitura.
 */
@Injectable()
export class ArtifactsSummaryService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Artefatos aguardando revisão humana — 1º item de *Esperando você* (§2.3).
   *
   * `PENDING_REVIEW` é o estado que a SPEC-032 define como "gerado, esperando
   * alguém olhar". `FAILED` **não** entra: run que falhou não espera revisão,
   * espera nova tentativa — misturá-los inflaria o contador com trabalho que
   * ninguém consegue fazer clicando.
   */
  async pendingReview(tenantId: string): Promise<PendingArtifact[]> {
    const linhas = await this.prisma.artifact.findMany({
      where: {
        tenantId,
        state: 'PENDING_REVIEW',
        clientProject: { deletedAt: null, client: { deletedAt: null } },
      },
      include: { clientProject: { select: { title: true } } },
      orderBy: { createdAt: 'asc' },
    });

    return linhas.map((a) => ({
      artifactId: a.id,
      clientProjectId: a.clientProjectId,
      title: a.clientProject.title,
      kind: a.kind,
      since: a.createdAt.toISOString(),
    }));
  }
}
