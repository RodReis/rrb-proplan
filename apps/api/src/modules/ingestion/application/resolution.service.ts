import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { resolveDocuments } from '../domain/document-resolver';
import { Entity, Resolution } from '../domain/entity';
import { parseProplanConfig } from '../domain/proplan-config';

const CONFIG_PATH = '.proplan/config.yml';

@Injectable()
export class ResolutionService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Recomputa e persiste a resolução de todas as entidades (replace-all), como
   * rebuildLinks. Cache derivado: apagar as linhas + re-sync reconstrói idêntico.
   * Config YAML quebrado → flag proplanConfigInvalid, mas a resolução segue
   * (cai na escada). Chamado no fim de todo sync (success e noop).
   */
  async rebuild(projectId: string): Promise<void> {
    const docs = await this.prisma.document.findMany({
      where: { projectId },
      select: { path: true, isConventional: true },
    });

    const configDoc = await this.prisma.document.findUnique({
      where: { projectId_path: { projectId, path: CONFIG_PATH } },
      select: { content: true },
    });
    const { config, invalid } = parseProplanConfig(configDoc?.content ?? null);

    // Linhas inference (nível 3) atuais: a escada nunca as produz — se a entidade
    // segue absent na nova escada, a inferência é preservada (ADR-014: inferência
    // > ausente). Se a escada resolve para convention/alias/config, a convenção
    // vence e a inference cede.
    const inferredByEntity = new Map(
      (
        await this.prisma.documentResolution.findMany({
          where: { projectId, source: 'inference' },
        })
      ).map((row) => [row.entity, row]),
    );
    // Só preserva a inference se o doc apontado ainda existir no doc-set atual —
    // senão o doc foi deletado num sync posterior e a linha ficaria órfã (aba
    // quebrada com 404 permanente ao tentar ler um path inexistente).
    const pathSet = new Set(docs.map((d) => d.path));

    const resolutions = resolveDocuments({ docs, config });
    const rows = resolutions.map((r) => {
      const candidate = r.source === 'absent' ? inferredByEntity.get(r.entity) : undefined;
      const inferred =
        candidate && candidate.path !== null && pathSet.has(candidate.path)
          ? candidate
          : undefined;
      if (inferred) {
        return {
          projectId,
          entity: r.entity,
          level: 3,
          source: 'inference',
          path: inferred.path,
          paths: inferred.paths,
          confidence: inferred.confidence,
        };
      }
      return {
        projectId,
        entity: r.entity,
        level: r.level,
        source: r.source,
        path: r.path,
        paths: r.paths,
        confidence: r.confidence,
      };
    });

    await this.prisma.$transaction([
      this.prisma.documentResolution.deleteMany({ where: { projectId } }),
      this.prisma.documentResolution.createMany({ data: rows }),
    ]);

    await this.prisma.project.update({
      where: { id: projectId },
      data: { proplanConfigInvalid: invalid },
    });
  }

  /**
   * Escreve uma aresta inferida (nível 3, IA) como resolução de fallback de uma
   * entidade. Guarda: só sobrescreve linha `absent` — nunca convenção, alias ou
   * config (hierarquia ADR-014: humano/convenção > inferência > ausente).
   */
  async writeInferredResolution(
    projectId: string,
    entity: Entity,
    path: string,
    confidence: number,
  ): Promise<void> {
    const row = await this.prisma.documentResolution.findUnique({
      where: { projectId_entity: { projectId, entity } },
    });
    if (!row || row.source !== 'absent') return;

    await this.prisma.documentResolution.update({
      where: { projectId_entity: { projectId, entity } },
      data: { level: 3, source: 'inference', path, confidence },
    });
  }

  /** Lê a resolução persistida de uma entidade (cache). */
  async resolutionOf(projectId: string, entity: Entity): Promise<Resolution> {
    const row = await this.prisma.documentResolution.findUnique({
      where: { projectId_entity: { projectId, entity } },
    });
    if (!row) {
      // Ainda não há resolução persistida (ex.: projeto recém-adicionado, sync em
      // andamento). Trata como ausente (nível 4) — degrada como listDocuments/graph,
      // não quebra a aba com 404. O próximo sync popula a linha real.
      return { entity, level: 4, source: 'absent', path: null, paths: [], confidence: 0 };
    }
    return {
      entity: row.entity as Entity,
      level: row.level as 1 | 2 | 3 | 4,
      source: row.source as Resolution['source'],
      path: row.path,
      paths: row.paths,
      confidence: row.confidence,
    };
  }
}
