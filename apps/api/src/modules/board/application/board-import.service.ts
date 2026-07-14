import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { GithubAuth } from '../../identity/application/github-auth.service';
import {
  GithubWritebackClient,
} from '../../../shared/github/github-writeback.client';
import { BoardColumn, COLUMN_LABEL, IssuePriority, PRIORITY_LABELS } from '../domain/column-mapping';
import { parseStatusMarkdown } from '../domain/status-parser';
import { LABEL_COLORS } from '../board.constants';
import { GithubIssuesClient } from '../infrastructure/github-issues.client';
import { BoardService } from './board.service';
import { ActivityService } from '../../activity/application/activity.service';

export interface CardToCreate {
  title: string;
  column: BoardColumn;
  priority?: IssuePriority | null;
}

const LEGACY_MIGRATION_NOTE =
  '> migrado para Issues — ver .proplan/STATUS.md\n';

/**
 * Cria issues em massa a partir de uma lista aprovada (SPEC-005). Fonte da
 * lista: parse de um STATUS.md legado (importação) ou proposta de IA (bootstrap).
 * A criação é sempre disparada pelo usuário — nunca automática. Escrita com
 * installation token (bot).
 */
@Injectable()
export class BoardImportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auth: GithubAuth,
    private readonly issues: GithubIssuesClient,
    private readonly writeback: GithubWritebackClient,
    private readonly board: BoardService,
    private readonly activity: ActivityService,
  ) {}

  /** Prévia dos cards de um `docs/STATUS.md` legado (não cria nada). */
  async previewFromStatus(userId: string, projectId: string): Promise<CardToCreate[]> {
    await this.assertOwner(userId, projectId);
    const legacy = await this.prisma.document.findUnique({
      where: { projectId_path: { projectId, path: 'docs/STATUS.md' } },
      select: { content: true },
    });
    if (!legacy) throw new NotFoundException('Projeto sem docs/STATUS.md para importar');
    return parseStatusMarkdown(legacy.content).map((c) => ({
      title: c.title,
      column: c.column,
      priority: c.priority,
    }));
  }

  /**
   * Cria as issues aprovadas nas colunas certas e re-sincroniza o cache.
   * Usado tanto pela importação de legado quanto pelo bootstrap de IA.
   * Para importação, deixa uma nota de migração no `docs/STATUS.md` legado.
   */
  async createCards(
    userId: string,
    projectId: string,
    cards: CardToCreate[],
    opts: { markLegacyMigrated?: boolean } = {},
  ): Promise<{ operationId: string }> {
    const project = await this.assertOwner(userId, projectId);
    const operationId = await this.activity.start(projectId, 'bootstrap');

    try {
      const token = await this.auth.installationToken(projectId);

      for (const card of cards) {
        const labels: string[] = [];
        if (card.column === 'backlog' || card.column === 'todo' || card.column === 'doing') {
          labels.push(COLUMN_LABEL[card.column]);
        }
        if (card.priority) labels.push(PRIORITY_LABELS[card.priority]);
        for (const name of labels) {
          await this.issues.ensureLabel(token, project.owner, project.name, name, LABEL_COLORS[name] ?? 'cccccc');
        }
        await this.issues.createIssue(token, project.owner, project.name, {
          title: card.title,
          labels,
        });
      }

      if (opts.markLegacyMigrated) {
        await this.appendMigrationNote(token, project);
      }

      await this.activity.advance(operationId, 'board');
      // Reflete as novas issues no cache (SPEC-005: re-sync após criar).
      await this.board.syncIssues(projectId);
      // Conclui síncrono: este fluxo não tem SyncRun de docs (cria issues).
      await this.activity.finish(operationId);
      return { operationId };
    } catch (err) {
      await this.activity.fail(
        operationId,
        err instanceof Error ? err.message : 'Falha ao criar os cards',
      );
      throw err;
    }
  }

  /** Prepend do aviso de migração no docs/STATUS.md legado (não apaga o doc). */
  private async appendMigrationNote(
    token: string,
    project: { owner: string; name: string; defaultBranch: string; id: string },
  ): Promise<void> {
    const path = 'docs/STATUS.md';
    const doc = await this.prisma.document.findUnique({
      where: { projectId_path: { projectId: project.id, path } },
      select: { content: true },
    });
    if (!doc || doc.content.startsWith(LEGACY_MIGRATION_NOTE)) return;
    const baseSha = await this.writeback.getFileSha(
      token,
      project.owner,
      project.name,
      path,
      project.defaultBranch,
    );
    await this.writeback.putFile({
      token,
      owner: project.owner,
      repo: project.name,
      path,
      branch: project.defaultBranch,
      content: LEGACY_MIGRATION_NOTE + '\n' + doc.content,
      message: 'proplan: aviso de migração do STATUS.md legado para Issues',
      baseSha,
    });
  }

  private async assertOwner(userId: string, projectId: string) {
    const project = await this.prisma.project.findFirst({
      where: { id: projectId, userId },
    });
    if (!project) throw new NotFoundException('Projeto não encontrado');
    return project;
  }
}
