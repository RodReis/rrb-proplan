import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { ContextService } from '../../context/application/context.service';
import { ResolutionService } from '../../ingestion/application/resolution.service';
import { SettingsService } from '../../settings/application/settings.service';
import { assertionsToCanonicalFields } from '../domain/assertion-fields';
import {
  assembleCanonicalModel,
  CanonicalFieldRow,
  CanonicalModel,
} from '../domain/canonical-model';
import {
  extractCanonicalFields,
  ResolutionInput,
  stalenessDaysBetween,
} from '../domain/extract-fields';

/**
 * Modelo canônico (SPEC-014, Fatia 9). Store reconstruível (ADR-014): populado
 * no sync a partir da resolução de documentos + staleness (determinístico, zero
 * IA). Servido por `getCanonicalModel` como projeção de leitura pura (ADR-002 —
 * sem IA no caminho de request).
 *
 * ADR-001: consome `ResolutionService` (cobertura) e `SettingsService` (limiar)
 * por interface pública — nunca lê document_resolutions/settings direto.
 */
@Injectable()
export class CanonicalService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly resolution: ResolutionService,
    private readonly settings: SettingsService,
    private readonly context: ContextService,
  ) {}

  /** Ownership id+userId (mesmo padrão de TabsService/BoardService). */
  private async assertOwner(userId: string, projectId: string) {
    const project = await this.prisma.project.findFirst({
      where: { id: projectId, userId },
    });
    if (!project) throw new NotFoundException('Projeto não encontrado');
    return project;
  }

  /**
   * Recomputa e persiste o CanonicalField do projeto (replace-all, como
   * rebuildLinks/resolution.rebuild). Determinístico e reconstruível: apagar +
   * re-sync reproduz idêntico. Chamado no fim de todo sync (success e noop).
   */
  async rebuild(projectId: string): Promise<void> {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: {
        docsScopeHash: true,
        lastDocsCommitAt: true,
        lastCodeCommitAt: true,
      },
    });
    if (!project) return; // projeto sumiu entre o enqueue e agora — nada a fazer

    const resolutions = await this.resolution.allResolutionsOf(projectId);
    const shas = await this.resolution.docShasOf(projectId);

    const inputs: ResolutionInput[] = resolutions.map((r) => ({
      entity: r.entity,
      level: r.level,
      source: r.source,
      path: r.path,
      paths: r.paths,
      sha: r.path ? (shas.get(r.path) ?? null) : null,
    }));

    const fields = extractCanonicalFields({
      resolutions: inputs,
      stalenessDays: stalenessDaysBetween(
        project.lastDocsCommitAt,
        project.lastCodeCommitAt,
      ),
      docsScopeHash: project.docsScopeHash ?? '',
      docsDate: project.lastDocsCommitAt
        ? project.lastDocsCommitAt.toISOString().slice(0, 10)
        : null,
    });

    // SPEC-015: `constraints` é projeção sobre Assertion (fonte: docs/CONTEXT.md).
    // Consumido pela interface pública do context (ADR-001) — o listener garante
    // que o context.rebuild rodou antes deste rebuild (ordem determinística).
    const assertions = await this.context.assertionsOf(projectId);
    fields.push(
      ...assertionsToCanonicalFields(assertions, project.docsScopeHash ?? ''),
    );

    // Replace-all em transação INTERATIVA, não em lote (padrão
    // resolution.rebuild — issue #113). O lote em array quebra sob
    // `runInTenantContext`: DELETE e INSERT acabam em conexões diferentes, fora
    // de ordem, e o INSERT colide no unique.
    await this.prisma.$transaction(async (tx) => {
      await tx.canonicalField.deleteMany({ where: { projectId } });
      await tx.canonicalField.createMany({
        data: fields.map((f) => ({
          projectId,
          entity: f.entity,
          field: f.field,
          value: f.value as Prisma.InputJsonValue,
          provenanceClass: f.provenanceClass,
          provenanceRef: f.provenanceRef as Prisma.InputJsonValue,
          confidence: f.confidence,
          confidenceMath: f.confidenceMath as unknown as Prisma.InputJsonValue,
          docsScopeHash: f.docsScopeHash,
        })),
      });
    });
  }

  /**
   * SPEC-019: cobertura "vermelha" por projeto para o radar (interface pública,
   * ADR-001 — o portfolio nunca lê canonical_fields direto). Um projeto está
   * vermelho quando tem ao menos um campo abaixo do limiar de recusa (a mesma
   * recusa do getCanonicalModel, só agregada). Determinístico, zero IA. Uma
   * query só sobre os N projetos. Projeto sem nenhum campo → não vermelho
   * (ausência de dado não é falha — mesma lógica do "não documentado").
   */
  async coverageRedByProject(
    userId: string,
    projectIds: string[],
  ): Promise<Map<string, boolean>> {
    const result = new Map<string, boolean>();
    if (projectIds.length === 0) return result;
    const threshold = await this.settings.canonicalThresholdOf(userId);
    // Limiar 0 desliga a recusa → nada é vermelho por cobertura.
    if (threshold <= 0) return result;
    const rows = await this.prisma.canonicalField.findMany({
      where: { projectId: { in: projectIds } },
      select: { projectId: true, confidence: true },
    });
    for (const r of rows) {
      if (r.confidence < threshold) result.set(r.projectId, true);
    }
    return result;
  }

  /**
   * Projeção de leitura: monta o objeto entidades→campos aplicando o limiar de
   * recusa. Sem IA (ADR-002) — só lê o CanonicalField já persistido.
   */
  async getCanonicalModel(
    userId: string,
    projectId: string,
  ): Promise<CanonicalModel> {
    await this.assertOwner(userId, projectId);
    const threshold = await this.settings.canonicalThresholdOf(userId);
    const rows = await this.prisma.canonicalField.findMany({
      where: { projectId },
    });
    const projected: CanonicalFieldRow[] = rows.map((r) => ({
      entity: r.entity,
      field: r.field,
      value: r.value,
      provenanceClass: r.provenanceClass as CanonicalFieldRow['provenanceClass'],
      provenanceRef: r.provenanceRef,
      confidence: r.confidence,
      confidenceMath: r.confidenceMath as unknown as CanonicalFieldRow['confidenceMath'],
    }));
    return assembleCanonicalModel(projected, threshold);
  }
}
