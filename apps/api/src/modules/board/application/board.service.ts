import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { GithubAuth } from '../../identity/application/github-auth.service';
import {
  BoardColumn,
  COLUMNS,
  columnOf,
  isClosedOutsideProplan,
  priorityOf,
} from '../domain/column-mapping';
import { isGeneratedProjection } from '../domain/status-parser';
import { GithubIssuesClient } from '../infrastructure/github-issues.client';

export interface BoardCard {
  number: number;
  title: string;
  column: BoardColumn;
  priority: 'alta' | 'media' | 'baixa' | null;
  assignee: { login: string; avatarUrl: string } | null;
  htmlUrl: string;
  /** Nascimento da issue no GitHub — o card mostra fora de Finalizado/Descartado. */
  createdAt: string;
  closedAt: string | null;
  /** Fechada fora do ProPlan (closed sem label) — badge em Finalizado (SPEC-005). */
  closedOutside: boolean;
}

export type BoardMode = 'active' | 'degraded' | 'no-installation';

export interface BoardView {
  mode: BoardMode;
  needsIssueImport: boolean;
  columns: { column: BoardColumn; cards: BoardCard[] }[];
}

@Injectable()
export class BoardService {
  private readonly logger = new Logger(BoardService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auth: GithubAuth,
    private readonly issues: GithubIssuesClient,
  ) {}

  /**
   * Sincroniza o cache de issues do projeto a partir da GitHub Issues API
   * (leitura com token do usuário — ADR-015). Recalcula coluna/prioridade/
   * assignee, faz replace-all no cache e atualiza `needsIssueImport`.
   * Repo com Issues desabilitada → não sincroniza (modo degradado é read-only).
   */
  async syncIssues(projectId: string): Promise<void> {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
    });
    if (!project) throw new NotFoundException('Projeto não encontrado');

    const token = await this.auth.userToken(project.userId);
    const enabled = await this.issues.issuesEnabled(token, project.owner, project.name);
    if (!enabled) {
      this.logger.warn(`Projeto ${projectId}: Issues desabilitada — modo degradado`);
      // Modo degradado não pode deixar cache órfão de sync anterior (banco = cache,
      // repo é fonte de verdade): sem issues no repo, o board tem de refletir vazio.
      await this.prisma.issue.deleteMany({ where: { projectId } });
      return;
    }

    const remote = await this.issues.listIssues(token, project.owner, project.name);
    const cards = remote.map((i) => {
      const labels = i.labels.map((l) => l.name);
      const assignee = i.assignees[0];
      return {
        projectId,
        number: i.number,
        title: i.title,
        state: i.state,
        column: columnOf(i.state, labels),
        closedOutside: isClosedOutsideProplan(i.state, labels),
        priority: priorityOf(labels),
        assigneeLogin: assignee?.login ?? null,
        assigneeAvatarUrl: assignee?.avatar_url ?? null,
        htmlUrl: i.html_url,
        createdAt: new Date(i.created_at),
        closedAt: i.closed_at ? new Date(i.closed_at) : null,
        updatedAt: new Date(i.updated_at),
      };
    });

    // Replace-all em transação: o cache reflete exatamente o remoto.
    await this.prisma.$transaction([
      this.prisma.issue.deleteMany({ where: { projectId } }),
      ...(cards.length
        ? [this.prisma.issue.createMany({ data: cards })]
        : []),
    ]);

    await this.updateNeedsIssueImport(projectId, remote.length > 0);
  }

  /**
   * Detecção de legado (SPEC-005): precisa importar quando o repo tem um
   * `docs/STATUS.md` legado (sem cabeçalho de projeção) **e** nenhuma issue
   * `proplan:*`. Se já há issues gerenciadas, não precisa.
   */
  private async updateNeedsIssueImport(
    projectId: string,
    hasManagedIssues: boolean,
  ): Promise<void> {
    let needs = false;
    if (!hasManagedIssues) {
      const legacy = await this.prisma.document.findUnique({
        where: { projectId_path: { projectId, path: 'docs/STATUS.md' } },
        select: { content: true },
      });
      needs = !!legacy && !isGeneratedProjection(legacy.content);
    }
    await this.prisma.project.update({
      where: { id: projectId },
      data: { needsIssueImport: needs },
    });
  }

  /** Board para a UI: 5 colunas com os cards do cache + modo e aviso. */
  async getBoard(userId: string, projectId: string): Promise<BoardView> {
    const project = await this.assertOwner(userId, projectId);

    const mode: BoardMode =
      project.installationStatus !== 'active' ? 'no-installation' : 'active';
    // O modo degradado (Issues off) é detectado no sync; aqui refletimos o
    // que o cache tem. Sem cache e sem instalação → a UI orienta.

    const issues = await this.prisma.issue.findMany({
      where: { projectId },
      orderBy: [{ priority: 'asc' }, { updatedAt: 'desc' }],
    });

    const byColumn = new Map<BoardColumn, BoardCard[]>();
    for (const col of COLUMNS) byColumn.set(col, []);
    for (const i of issues) {
      byColumn.get(i.column)?.push({
        number: i.number,
        title: i.title,
        column: i.column,
        priority: i.priority,
        assignee: i.assigneeLogin
          ? { login: i.assigneeLogin, avatarUrl: i.assigneeAvatarUrl ?? '' }
          : null,
        htmlUrl: i.htmlUrl,
        createdAt: i.createdAt.toISOString(),
        closedAt: i.closedAt?.toISOString() ?? null,
        closedOutside: i.closedOutside,
      });
    }

    return {
      mode,
      needsIssueImport: project.needsIssueImport,
      columns: COLUMNS.map((column) => ({ column, cards: byColumn.get(column) ?? [] })),
    };
  }

  private async assertOwner(userId: string, projectId: string) {
    const project = await this.prisma.project.findFirst({
      where: { id: projectId, userId },
    });
    if (!project) throw new NotFoundException('Projeto não encontrado');
    return project;
  }
}
