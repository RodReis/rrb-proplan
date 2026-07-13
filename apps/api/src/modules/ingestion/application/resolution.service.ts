import { Injectable, NotFoundException } from '@nestjs/common';
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

    const resolutions = resolveDocuments({ docs, config });
    const rows = resolutions.map((r) => ({
      projectId,
      entity: r.entity,
      level: r.level,
      source: r.source,
      path: r.path,
      paths: r.paths,
      confidence: r.confidence,
    }));

    await this.prisma.$transaction([
      this.prisma.documentResolution.deleteMany({ where: { projectId } }),
      this.prisma.documentResolution.createMany({ data: rows }),
    ]);

    await this.prisma.project.update({
      where: { id: projectId },
      data: { proplanConfigInvalid: invalid },
    });
  }

  /** Lê a resolução persistida de uma entidade (cache). */
  async resolutionOf(projectId: string, entity: Entity): Promise<Resolution> {
    const row = await this.prisma.documentResolution.findUnique({
      where: { projectId_entity: { projectId, entity } },
    });
    if (!row) throw new NotFoundException(`Resolução não encontrada: ${entity}`);
    return {
      entity: row.entity as Entity,
      level: row.level as 1 | 2 | 4,
      source: row.source as Resolution['source'],
      path: row.path,
      paths: row.paths,
      confidence: row.confidence,
    };
  }
}
