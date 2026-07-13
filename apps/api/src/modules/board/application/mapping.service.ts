import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { GithubAuth } from '../../identity/application/github-auth.service';
import {
  GithubWritebackClient,
  WritebackConflictError,
} from '../../../shared/github/github-writeback.client';
import { IngestionService } from '../../ingestion/application/ingestion.service';
import { ResolutionService } from '../../ingestion/application/resolution.service';
import { Entity, ENTITIES, Resolution } from '../../ingestion/domain/entity';
import {
  mergeProplanConfig,
  parseProplanConfig,
  serializeProplanConfig,
} from '../../ingestion/domain/proplan-config';

const CONFIG_PATH = '.proplan/config.yml';

export interface MappingRow {
  entity: Entity;
  resolution: Resolution;
  candidates: string[]; // arquivos e diretórios do repo
}

/**
 * Mapeamento manual de documentos (ADR-014, Fatia 6): lista as 6 entidades com
 * a resolução atual + candidatos, e escreve a decisão do usuário em
 * `.proplan/config.yml` via write-back (installation token, ADR-015).
 */
@Injectable()
export class MappingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auth: GithubAuth,
    private readonly writeback: GithubWritebackClient,
    private readonly ingestion: IngestionService,
    private readonly resolution: ResolutionService,
  ) {}

  /** As 6 entidades com a resolução atual + candidatos (paths + diretórios do repo). */
  async getMapping(
    projectId: string,
  ): Promise<{ rows: MappingRow[]; proplanConfigInvalid: boolean }> {
    const docs = await this.prisma.document.findMany({
      where: { projectId },
      select: { path: true },
    });
    const files = docs.map((d) => d.path);
    const dirs = Array.from(
      new Set(
        files
          .map((p) => p.split('/').slice(0, -1).join('/'))
          .filter(Boolean)
          .map((d) => d + '/'),
      ),
    );
    const candidates = [...files, ...dirs].sort();

    const rows: MappingRow[] = [];
    for (const entity of ENTITIES) {
      const resolution = await this.resolution.resolutionOf(projectId, entity);
      rows.push({ entity, resolution, candidates });
    }

    // Flag gravado pelo ResolutionService quando .proplan/config.yml tem YAML inválido (ADR-014).
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { proplanConfigInvalid: true },
    });
    return { rows, proplanConfigInvalid: project?.proplanConfigInvalid ?? false };
  }

  /** Escreve a entidade em .proplan/config.yml (ler-mesclar-reescrever) + re-sync. */
  async putMapping(
    projectId: string,
    entity: Entity,
    path: string | null,
  ): Promise<{ syncRunId: string }> {
    const project = await this.prisma.project.findUnique({ where: { id: projectId } });
    if (!project) throw new NotFoundException('Projeto não encontrado');

    const current = await this.prisma.document.findUnique({
      where: { projectId_path: { projectId, path: CONFIG_PATH } },
      select: { content: true },
    });
    const { config } = parseProplanConfig(current?.content ?? null);
    const merged = mergeProplanConfig(config, entity, path);
    const content = serializeProplanConfig(merged);

    const token = await this.auth.installationToken(projectId);
    let newBlobSha = '';
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const baseSha = await this.writeback.getFileSha(
          token,
          project.owner,
          project.name,
          CONFIG_PATH,
          project.defaultBranch,
        );
        newBlobSha = await this.writeback.putFile({
          token,
          owner: project.owner,
          repo: project.name,
          path: CONFIG_PATH,
          branch: project.defaultBranch,
          content,
          message: `proplan: mapeia ${entity} → ${path ?? 'ausente'} (.proplan/config.yml)`,
          baseSha,
        });
        break;
      } catch (err) {
        if (err instanceof WritebackConflictError && attempt === 0) continue;
        throw err;
      }
    }

    // Espera a Trees API refletir este commit antes de o sync decidir noop
    // (consistência eventual — ver SyncService.listScope).
    return this.ingestion.enqueueSync(projectId, {
      path: CONFIG_PATH,
      blobSha: newBlobSha,
    });
  }
}
