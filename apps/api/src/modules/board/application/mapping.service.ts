import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { GithubAuth } from '../../identity/application/github-auth.service';
import { GithubWritebackClient } from '../../../shared/github/github-writeback.client';
import { putFileWithMerge } from '../../../shared/github/writeback-merge';
import { IngestionService } from '../../ingestion/application/ingestion.service';
import { ResolutionService } from '../../ingestion/application/resolution.service';
import { Entity, ENTITIES, Resolution } from '../../ingestion/domain/entity';
import { ActivityService } from '../../activity/application/activity.service';
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
    private readonly activity: ActivityService,
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

  /**
   * Escreve a entidade em .proplan/config.yml (ler-mesclar-reescrever) + re-sync.
   * Retorna `{ operationId }` (SPEC-010): passos nomeados visíveis, aba recarrega
   * sozinha. Concluída quando o SyncRun termina (ver ActivityService.get).
   */
  async putMapping(
    projectId: string,
    entity: Entity,
    path: string | null,
  ): Promise<{ operationId: string }> {
    const project = await this.prisma.project.findUnique({ where: { id: projectId } });
    if (!project) throw new NotFoundException('Projeto não encontrado');
    const operationId = await this.activity.start(projectId, 'mapping', CONFIG_PATH);

    try {
      const token = await this.auth.installationToken(projectId);
      // O merge roda dentro do helper, sobre o conteúdo VIVO do repo, e é
      // reaplicado no retry — o caminho antigo computava o conteúdo uma vez,
      // antes do loop, e no 409 re-enviava o merge do snapshot velho,
      // apagando quem tivesse editado o config à mão (ARCHITECTURE.md →
      // Resiliência: "409 → re-sync, reaplicar mudança, um retry").
      const newBlobSha = await putFileWithMerge({
        writeback: this.writeback,
        token,
        owner: project.owner,
        repo: project.name,
        path: CONFIG_PATH,
        branch: project.defaultBranch,
        message: `proplan: mapeia ${entity} → ${path ?? 'ausente'} (.proplan/config.yml)`,
        mutate: (live) => {
          const { config } = parseProplanConfig(live);
          return serializeProplanConfig(mergeProplanConfig(config, entity, path));
        },
      });

      const commitUrl = `https://github.com/${project.owner}/${project.name}/blob/${project.defaultBranch}/${CONFIG_PATH}`;
      await this.activity.attachArtifacts(operationId, { commitUrl });
      await this.activity.advance(operationId, 'propagate');

      // Espera a Trees API refletir este commit antes de o sync decidir noop
      // (consistência eventual — ver SyncService.listScope).
      const { syncRunId } = await this.ingestion.enqueueSync(projectId, {
        path: CONFIG_PATH,
        blobSha: newBlobSha,
      });
      await this.activity.advance(operationId, 'sync');
      await this.activity.attachArtifacts(operationId, { syncRunId });
      return { operationId };
    } catch (err) {
      await this.activity.fail(
        operationId,
        err instanceof Error ? err.message : 'Falha ao salvar o mapeamento',
      );
      throw err;
    }
  }
}
