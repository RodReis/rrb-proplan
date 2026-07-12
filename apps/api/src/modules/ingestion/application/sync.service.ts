import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuthService } from '../../identity/application/auth.service';
import { diffScope } from '../domain/diff';
import { parseFrontmatter } from '../domain/frontmatter';
import { computeScopeHash } from '../domain/scope-hash';
import { isInScope } from '../domain/scope-filter';
import { GithubGitClient } from '../infrastructure/github-git.client';

/** Evento de domínio: docs de um projeto foram sincronizados com hash novo. */
export class DocsSyncedEvent {
  constructor(
    readonly projectId: string,
    readonly docsScopeHash: string,
  ) {}
}
export const DOCS_SYNCED = 'docs.synced';

export interface SyncResult {
  status: 'success' | 'noop' | 'failed';
  added: number;
  updated: number;
  removed: number;
  skipped: number;
}

@Injectable()
export class SyncService {
  private readonly logger = new Logger(SyncService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auth: AuthService,
    private readonly git: GithubGitClient,
    private readonly events: EventEmitter2,
  ) {}

  /**
   * Executa um sync run já existente (criado como `queued` pelo enqueue).
   * Idempotente por (projectId, docsScopeHash): hash igual → no-op auditado.
   */
  async runSync(syncRunId: string): Promise<void> {
    const run = await this.prisma.syncRun.findUnique({
      where: { id: syncRunId },
      include: { project: true },
    });
    if (!run) throw new NotFoundException('SyncRun não encontrado');
    const project = run.project;

    await this.prisma.syncRun.update({
      where: { id: run.id },
      data: { status: 'running' },
    });

    try {
      const token = await this.auth.githubTokenOf(project.userId);
      const tree = await this.git.listTree(
        token,
        project.owner,
        project.name,
        project.defaultBranch,
      );
      const scope = tree.filter((b) => isInScope(b.path));
      const scopeHash = computeScopeHash(scope);

      // Idempotência: hash igual ao último aplicado → no-op sem downloads.
      if (project.docsScopeHash === scopeHash) {
        await this.updateCommitMeta(project.id, token, project.owner, project.name);
        await this.finish(run.id, 'noop', scopeHash, {
          added: 0,
          updated: 0,
          removed: 0,
          skipped: 0,
        });
        return;
      }

      const localDocs = await this.prisma.document.findMany({
        where: { projectId: project.id },
        select: { path: true, blobSha: true },
      });
      const local = new Map(localDocs.map((d) => [d.path, d.blobSha]));
      const { added, updated, removed } = diffScope(scope, local);

      let skipped = 0;
      for (const entry of [...added, ...updated]) {
        const blob = await this.git.getBlob(
          token,
          project.owner,
          project.name,
          entry.blobSha,
        );
        if (blob === null) {
          skipped++;
          this.logger.warn(
            `Blob ${entry.path} acima de 512 KB — ignorado no projeto ${project.id}`,
          );
          continue;
        }
        const fm = parseFrontmatter(blob.content);
        // Prisma Json aceita Prisma.JsonNull para limpar; frontmatter é objeto simples.
        const frontmatter = (fm.data ?? Prisma.JsonNull) as Prisma.InputJsonValue;
        await this.prisma.document.upsert({
          where: { projectId_path: { projectId: project.id, path: entry.path } },
          create: {
            projectId: project.id,
            path: entry.path,
            blobSha: entry.blobSha,
            content: blob.content,
            frontmatter,
            isConventional: fm.isConventional,
            byteSize: blob.byteSize,
          },
          update: {
            blobSha: entry.blobSha,
            content: blob.content,
            frontmatter,
            isConventional: fm.isConventional,
            byteSize: blob.byteSize,
          },
        });
      }

      if (removed.length > 0) {
        await this.prisma.document.deleteMany({
          where: { projectId: project.id, path: { in: removed } },
        });
      }

      await this.prisma.project.update({
        where: { id: project.id },
        data: { docsScopeHash: scopeHash, lastSyncAt: new Date() },
      });

      await this.updateCommitMeta(project.id, token, project.owner, project.name);

      await this.finish(run.id, 'success', scopeHash, {
        added: added.length,
        updated: updated.length,
        removed: removed.length,
        skipped,
      });

      this.events.emit(DOCS_SYNCED, new DocsSyncedEvent(project.id, scopeHash));
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erro desconhecido';
      await this.prisma.syncRun.update({
        where: { id: run.id },
        data: { status: 'failed', error: message, finishedAt: new Date() },
      });
      // Relança para o BullMQ contabilizar a tentativa (retry com backoff).
      throw err;
    }
  }

  /**
   * Coleta metadados de defasagem (ADR-010): data do último commit em `docs`
   * e do último commit do repo. Falha aqui NÃO falha o sync — os campos ficam
   * como estavam (ou nulos) e a UI apenas omite o bloco de frescor.
   */
  private async updateCommitMeta(
    projectId: string,
    token: string,
    owner: string,
    name: string,
  ): Promise<void> {
    try {
      const [lastDocsCommitAt, lastCodeCommitAt] = await Promise.all([
        this.git.getLastCommitDate(token, owner, name, 'docs'),
        this.git.getLastCommitDate(token, owner, name),
      ]);
      await this.prisma.project.update({
        where: { id: projectId },
        data: {
          lastDocsCommitAt,
          lastCodeCommitAt,
          commitMetaSyncedAt: new Date(),
        },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'erro';
      this.logger.warn(
        `Coleta de metadados de commit falhou (projeto ${projectId}): ${message}`,
      );
    }
  }

  private async finish(
    runId: string,
    status: 'success' | 'noop',
    docsScopeHash: string,
    counts: { added: number; updated: number; removed: number; skipped: number },
  ): Promise<void> {
    await this.prisma.syncRun.update({
      where: { id: runId },
      data: { status, docsScopeHash, ...counts, finishedAt: new Date() },
    });
  }
}
