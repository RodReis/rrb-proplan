import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { GithubAuth } from '../../identity/application/github-auth.service';
import {
  BoardColumn,
  COLUMNS,
  columnOf,
  isClosedOutsideProplan,
  isEpic,
  priorityOf,
} from '../domain/column-mapping';
import { type CardDetail, toCardDetail } from '../domain/card-detail';
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
  /** Número do épico-pai (null = raiz). A UI agrupa os cards por este campo (SPEC-024). */
  parentNumber: number | null;
}

/** Épico = faixa/agrupador (SPEC-024). Não anda pelas colunas; a UI o usa como cabeçalho. */
export interface BoardEpic {
  number: number;
  title: string;
  htmlUrl: string;
  /** Filhas fechadas / total — a faixa exibe `fechadas/total` (SPEC-024, sem barra). */
  closedChildren: number;
  totalChildren: number;
}

export type BoardMode = 'active' | 'degraded' | 'no-installation';

export interface BoardView {
  mode: BoardMode;
  needsIssueImport: boolean;
  columns: { column: BoardColumn; cards: BoardCard[] }[];
  /** Épicos abertos (issues com sub-issues), para a UI renderizar as faixas. */
  epics: BoardEpic[];
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

    const remote = await this.issues.listIssuesWithHierarchy(token, project.owner, project.name);
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
        // Hierarquia (SPEC-024): ausentes no fallback REST → raiz/não-épico.
        parentNumber: i.parentNumber ?? null,
        hasSubIssues: i.hasSubIssues ?? false,
      };
    });

    // Replace-all em transação: o cache reflete exatamente o remoto.
    // Interativa, não em lote (issue #113): o lote em array quebra sob
    // `runInTenantContext` — cada operação vem embrulhada na própria transação,
    // DELETE e INSERT saem em conexões diferentes e o INSERT pode commitar
    // primeiro, colidindo no unique.
    await this.prisma.$transaction(async (tx) => {
      await tx.issue.deleteMany({ where: { projectId } });
      if (cards.length) await tx.issue.createMany({ data: cards });
    });

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

    // Contagem de filhas por épico (fechadas/total) para o rótulo da faixa
    // (SPEC-024). Toda issue com `parentNumber` é filha; fechada = state closed.
    const childTotal = new Map<number, number>();
    const childClosed = new Map<number, number>();
    for (const i of issues) {
      if (i.parentNumber == null) continue;
      childTotal.set(i.parentNumber, (childTotal.get(i.parentNumber) ?? 0) + 1);
      if (i.state === 'closed') {
        childClosed.set(i.parentNumber, (childClosed.get(i.parentNumber) ?? 0) + 1);
      }
    }

    const byColumn = new Map<BoardColumn, BoardCard[]>();
    for (const col of COLUMNS) byColumn.set(col, []);
    const epics: BoardEpic[] = [];
    for (const i of issues) {
      // Épico é faixa, não card: sai da classificação de coluna (SPEC-024).
      // Épico fechado não vira faixa — some das colunas abertas (só expomos os
      // que estão em coluna aberta, isto é, `state === 'open'`).
      if (isEpic(i.hasSubIssues)) {
        if (i.state === 'open') {
          epics.push({
            number: i.number,
            title: i.title,
            htmlUrl: i.htmlUrl,
            closedChildren: childClosed.get(i.number) ?? 0,
            totalChildren: childTotal.get(i.number) ?? 0,
          });
        }
        continue;
      }
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
        parentNumber: i.parentNumber ?? null,
      });
    }

    // Finalizado é histórico de aceite, não fila de trabalho: ordena pela data
    // de finalização (mais recente primeiro), não por prioridade — numa coluna
    // fechada a prioridade é ruído (decisão do PI 2026-07-20; emenda à SPEC-005
    // linha 109, que fixava prioridade+updated_at para TODAS as colunas).
    // Sem `closedAt` (ex.: fechada fora do ProPlan) cai para o fim, preservando
    // a ordem que veio do banco — nunca inventa data.
    byColumn.get('finalized')?.sort((a, b) => {
      if (a.closedAt === b.closedAt) return 0;
      if (a.closedAt === null) return 1;
      if (b.closedAt === null) return -1;
      return b.closedAt.localeCompare(a.closedAt); // ISO-8601 ordena como string
    });

    return {
      mode,
      needsIssueImport: project.needsIssueImport,
      columns: COLUMNS.map((column) => ({ column, cards: byColumn.get(column) ?? [] })),
      epics,
    };
  }

  /**
   * Detalhe de um card: corpo, metadados e trilha, **lidos ao vivo no GitHub**
   * (SPEC-030). Duas chamadas, nada persistido — o ADR-017 proíbe virar a
   * segunda fonte defasada de um fato que o GitHub serve agora.
   *
   * Duas notas sobre de quem é o token:
   * - a leitura usa o token do **dono do projeto** (`project.userId`), igual ao
   *   `syncIssues` e ao `getBoard`. Um membro do tenant não tem,
   *   necessariamente, acesso próprio ao repo;
   * - é **user-to-server** (ADR-015). Installation token aqui seria leitura com
   *   identidade do bot — proibido, e barrado pelo teste de arquitetura.
   */
  async cardDetail(
    userId: string,
    projectId: string,
    number: number,
  ): Promise<CardDetail> {
    const project = await this.assertOwner(userId, projectId);
    const token = await this.auth.userToken(project.userId);

    // Em paralelo: são independentes, e a latência aparece no open da gaveta.
    const [issue, timeline] = await Promise.all([
      this.issues.issueDetail(token, project.owner, project.name, number),
      this.issues.issueTimeline(token, project.owner, project.name, number),
    ]);

    return toCardDetail(issue, timeline, new Date());
  }

  private async assertOwner(userId: string, projectId: string) {
    const project = await this.prisma.project.findFirst({
      where: { id: projectId, userId },
    });
    if (!project) throw new NotFoundException('Projeto não encontrado');
    return project;
  }
}
