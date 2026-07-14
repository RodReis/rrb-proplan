import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { GithubAuth } from '../../identity/application/github-auth.service';
import {
  COLUMN_LABEL,
  columnOf,
  DISCARDED_LABEL,
  FINALIZED_LABEL,
  priorityOf,
  PRIORITY_LABELS,
  STAMPED_COLUMNS,
  transitionTo,
} from '../domain/column-mapping';
import { LABEL_COLORS } from '../board.constants';
import { GithubIssue, GithubIssuesClient } from '../infrastructure/github-issues.client';
import { MutationInput } from './board-mutation.service';

/**
 * Aplica uma mutação de board na GitHub Issues API (installation token —
 * escrita, identidade proplan[bot], ADR-015). Só a Issues API define o estado
 * do card; a projeção é consequência (roda depois, com debounce). O fim do
 * ciclo de vida da mutação é `applied` — a projeção não bloqueia o card.
 */
@Injectable()
export class MutationApplierService {
  private readonly logger = new Logger(MutationApplierService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auth: GithubAuth,
    private readonly issues: GithubIssuesClient,
  ) {}

  /** Executa a mutação e devolve as labels/estado resultantes (para cache). */
  async apply(projectId: string, input: MutationInput): Promise<void> {
    const project = await this.prisma.project.findUniqueOrThrow({
      where: { id: projectId },
    });
    const token = await this.auth.installationToken(projectId);
    const { owner, name: repo } = project;

    switch (input.type) {
      case 'create_card':
        return this.createCard(token, owner, repo, projectId, input);
      case 'move_column':
        return this.moveColumn(token, owner, repo, projectId, input);
      case 'discard_card':
        return this.moveColumn(token, owner, repo, projectId, {
          type: 'move_column',
          number: input.number,
          toColumn: 'discarded',
        });
      case 'edit_card':
        return this.editCard(token, owner, repo, projectId, input);
    }
  }

  private async createCard(
    token: string,
    owner: string,
    repo: string,
    projectId: string,
    input: Extract<MutationInput, { type: 'create_card' }>,
  ): Promise<void> {
    const labels: string[] = [];
    if (
      input.column === 'todo' ||
      input.column === 'doing' ||
      input.column === 'backlog' ||
      input.column === 'done'
    ) {
      labels.push(COLUMN_LABEL[input.column]);
    }
    if (input.priority) labels.push(PRIORITY_LABELS[input.priority]);
    await this.ensureLabels(token, owner, repo, labels);
    const issue = await this.issues.createIssue(token, owner, repo, {
      title: input.title,
      labels,
    });
    await this.cacheIssue(projectId, issue);
  }

  private async moveColumn(
    token: string,
    owner: string,
    repo: string,
    projectId: string,
    input: Extract<MutationInput, { type: 'move_column' }>,
  ): Promise<void> {
    const current = await this.currentLabels(projectId, input.number);
    const t = transitionTo(input.toColumn);
    const nextLabels = current
      .filter((l) => !t.removeLabels.includes(l))
      .concat(t.addLabels.filter((l) => !current.includes(l)));
    await this.ensureLabels(token, owner, repo, t.addLabels);
    const issue = await this.issues.patchIssue(token, owner, repo, input.number, {
      state: t.state,
      labels: nextLabels,
    });
    await this.cacheIssue(projectId, issue);
    await this.stampIfNeeded(token, owner, repo, input.number, input.toColumn);
  }

  /**
   * Carimbo de aceite/descarte (SPEC-005): ao mover para Finalizado/Descartado,
   * posta um comentário permanente na issue — evidência auditável, não cache.
   * `closed_at` marca a entrega; este comentário marca o aceite/descarte.
   */
  private async stampIfNeeded(
    token: string,
    owner: string,
    repo: string,
    number: number,
    toColumn: string,
  ): Promise<void> {
    if (!STAMPED_COLUMNS.includes(toColumn as never)) return;
    const date = new Date().toISOString().slice(0, 10);
    const body =
      toColumn === 'finalized'
        ? `proplan: finalizado pelo PI em ${date}`
        : `proplan: descartado em ${date}`;
    await this.issues.comment(token, owner, repo, number, body);
  }

  private async editCard(
    token: string,
    owner: string,
    repo: string,
    projectId: string,
    input: Extract<MutationInput, { type: 'edit_card' }>,
  ): Promise<void> {
    const current = await this.currentLabels(projectId, input.number);
    // Reescreve as labels prio:* se a prioridade foi informada (null = remover).
    let labels = current;
    if (input.priority !== undefined) {
      labels = current.filter((l) => !Object.values(PRIORITY_LABELS).includes(l));
      if (input.priority) {
        labels.push(PRIORITY_LABELS[input.priority]);
        await this.ensureLabels(token, owner, repo, [PRIORITY_LABELS[input.priority]]);
      }
    }
    const issue = await this.issues.patchIssue(token, owner, repo, input.number, {
      ...(input.title !== undefined ? { title: input.title } : {}),
      ...(input.priority !== undefined ? { labels } : {}),
    });
    await this.cacheIssue(projectId, issue);
  }

  /** Labels atuais da issue, do cache (evita um GET extra). */
  private async currentLabels(projectId: string, number: number): Promise<string[]> {
    const cached = await this.prisma.issue.findUnique({
      where: { projectId_number: { projectId, number } },
      select: { column: true, priority: true, state: true },
    });
    if (!cached) return [];
    const labels: string[] = [];
    if (cached.state === 'open') {
      // Feito é aberta (ADR-011) — `proplan:done` entra aqui como as demais.
      if (
        cached.column === 'todo' ||
        cached.column === 'doing' ||
        cached.column === 'backlog' ||
        cached.column === 'done'
      ) {
        labels.push(COLUMN_LABEL[cached.column]);
      }
    } else if (cached.column === 'discarded') {
      labels.push(DISCARDED_LABEL);
    } else if (cached.column === 'finalized') {
      labels.push(FINALIZED_LABEL);
    }
    if (cached.priority) labels.push(PRIORITY_LABELS[cached.priority]);
    return labels;
  }

  private async ensureLabels(
    token: string,
    owner: string,
    repo: string,
    labels: string[],
  ): Promise<void> {
    for (const name of labels) {
      await this.issues.ensureLabel(token, owner, repo, name, LABEL_COLORS[name] ?? 'cccccc');
    }
  }

  /** Atualiza o cache local a partir da issue retornada pela API. */
  private async cacheIssue(projectId: string, issue: GithubIssue): Promise<void> {
    const labels = issue.labels.map((l) => l.name);
    const assignee = issue.assignees[0];
    const data = {
      title: issue.title,
      state: issue.state,
      column: columnOf(issue.state, labels),
      priority: priorityOf(labels),
      assigneeLogin: assignee?.login ?? null,
      assigneeAvatarUrl: assignee?.avatar_url ?? null,
      htmlUrl: issue.html_url,
      closedAt: issue.closed_at ? new Date(issue.closed_at) : null,
      updatedAt: new Date(issue.updated_at),
    };
    await this.prisma.issue.upsert({
      where: { projectId_number: { projectId, number: issue.number } },
      create: { projectId, number: issue.number, ...data },
      update: data,
    });
  }
}
