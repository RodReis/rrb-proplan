import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuthService } from '../../identity/application/auth.service';
import { IngestionService } from '../../ingestion/application/ingestion.service';
import { SettingsService } from '../../settings/application/settings.service';
import { computeFreshness, Freshness } from '../domain/freshness';
import { GithubClient, RepoSummary } from '../infrastructure/github.client';

export interface RepoWithManaged extends RepoSummary {
  managedProjectId: string | null;
}

@Injectable()
export class CatalogService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auth: AuthService,
    private readonly github: GithubClient,
    private readonly ingestion: IngestionService,
    private readonly settings: SettingsService,
  ) {}

  /**
   * Frescor da documentação (ADR-010). `stale` é calculado aqui, na leitura,
   * comparando as datas do Project com o limiar corrente do Settings —
   * nunca persistido (mudar o limiar reflete sem re-sync).
   */
  async freshness(userId: string, projectId: string): Promise<Freshness> {
    const project = await this.prisma.project.findFirst({
      where: { id: projectId, userId },
      select: { lastDocsCommitAt: true, lastCodeCommitAt: true },
    });
    if (!project) throw new NotFoundException('Projeto não encontrado');
    const thresholdDays = await this.settings.thresholdDaysOf(userId);
    return computeFreshness(
      project.lastDocsCommitAt,
      project.lastCodeCommitAt,
      thresholdDays,
    );
  }

  async listRepos(userId: string): Promise<RepoWithManaged[]> {
    const token = await this.auth.githubTokenOf(userId);
    const [repos, projects] = await Promise.all([
      this.github.listRepos(token),
      this.prisma.project.findMany({ where: { userId } }),
    ]);
    const managed = new Map<string, string>(
      projects.map((p) => [p.githubRepoId.toString(), p.id]),
    );
    return repos.map((r) => ({
      ...r,
      managedProjectId: managed.get(r.githubRepoId.toString()) ?? null,
    }));
  }

  async listProjects(userId: string) {
    const projects = await this.prisma.project.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
    return projects.map((p) => ({ ...p, githubRepoId: Number(p.githubRepoId) }));
  }

  async addProject(userId: string, repo: RepoSummary) {
    const existing = await this.prisma.project.findUnique({
      where: {
        userId_githubRepoId: {
          userId,
          githubRepoId: BigInt(repo.githubRepoId),
        },
      },
      select: { id: true },
    });

    const project = await this.prisma.project.upsert({
      where: {
        userId_githubRepoId: {
          userId,
          githubRepoId: BigInt(repo.githubRepoId),
        },
      },
      create: {
        userId,
        githubRepoId: BigInt(repo.githubRepoId),
        owner: repo.owner,
        name: repo.name,
        description: repo.description,
        defaultBranch: repo.defaultBranch,
        isPrivate: repo.isPrivate,
      },
      update: {},
    });

    // Primeira vez que o repo é marcado como gerenciado → primeira ingestão
    // automática (SPEC-002 critério de aceite). Re-marcar não re-enfileira.
    if (!existing) {
      await this.ingestion.enqueueSync(project.id);
    }

    return { ...project, githubRepoId: Number(project.githubRepoId) };
  }

  async removeProject(userId: string, projectId: string): Promise<void> {
    const { count } = await this.prisma.project.deleteMany({
      where: { id: projectId, userId },
    });
    if (count === 0) throw new NotFoundException('Projeto não encontrado');
  }
}
