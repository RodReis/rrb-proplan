import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { GithubAuth } from '../../identity/application/github-auth.service';
import { GithubInstallationsClient } from '../../identity/infrastructure/github-installations.client';
import { IngestionService } from '../../ingestion/application/ingestion.service';
import { SettingsService } from '../../settings/application/settings.service';
import { computeFreshness, Freshness } from '../domain/freshness';
import { reconcileInstallations } from '../domain/installation-reconcile';
import { GithubClient, RepoSummary } from '../infrastructure/github.client';

export interface RepoWithManaged extends RepoSummary {
  installationId: number;
  managedProjectId: string | null;
}

/** Um grupo do catálogo = uma instalação do App em uma conta (ADR-015). */
export interface InstallationGroup {
  installationId: number;
  account: string;
  accountType: 'User' | 'Organization';
  /** Repos acessíveis. Vazio = "instalação sem repositórios acessíveis". */
  repos: RepoWithManaged[];
}

export interface CatalogInstallations {
  groups: InstallationGroup[];
  /** true quando não há nenhuma instalação — estado vazio "Instalar no GitHub". */
  empty: boolean;
}

@Injectable()
export class CatalogService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auth: GithubAuth,
    private readonly github: GithubClient,
    private readonly installationsClient: GithubInstallationsClient,
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

  /**
   * Catálogo por instalação do GitHub App (ADR-015), agrupado por conta. Lista
   * as instalações visíveis para o usuário e os repos de cada uma, com o token
   * dele (leitura respeita a visibilidade real). Reconcilia o `installationStatus`
   * dos projetos gerenciados (repo sumiu de toda instalação → `missing`).
   */
  async listInstallations(userId: string): Promise<CatalogInstallations> {
    const token = await this.auth.userToken(userId);
    const installations = await this.installationsClient.list(token);

    const [projects, reposByInstallation] = await Promise.all([
      this.prisma.project.findMany({ where: { userId } }),
      Promise.all(
        installations.map((inst) =>
          this.github
            .listInstallationRepos(token, inst.id)
            .then((repos) => ({ inst, repos })),
        ),
      ),
    ]);

    const managed = new Map<string, string>(
      projects.map((p) => [p.githubRepoId.toString(), p.id]),
    );

    // Mapa repoId → installationId visível agora, para reconciliar status.
    const visibleRepoInstallation = new Map<string, number>();
    for (const { inst, repos } of reposByInstallation) {
      for (const r of repos) {
        visibleRepoInstallation.set(r.githubRepoId.toString(), inst.id);
      }
    }
    await this.applyReconcile(projects, visibleRepoInstallation);

    const groups: InstallationGroup[] = reposByInstallation.map(({ inst, repos }) => ({
      installationId: inst.id,
      account: inst.account.login,
      accountType: inst.account.type,
      repos: repos.map((r) => ({
        ...r,
        installationId: inst.id,
        managedProjectId: managed.get(r.githubRepoId.toString()) ?? null,
      })),
    }));

    return { groups, empty: installations.length === 0 };
  }

  /** Persiste o diff de installationStatus/id calculado pelo domínio. */
  private async applyReconcile(
    projects: { id: string; githubRepoId: bigint; installationId: number | null; installationStatus: 'active' | 'missing' }[],
    visibleRepoInstallation: Map<string, number>,
  ): Promise<void> {
    const updates = reconcileInstallations(
      projects.map((p) => ({
        id: p.id,
        githubRepoId: p.githubRepoId.toString(),
        installationId: p.installationId,
        installationStatus: p.installationStatus,
      })),
      visibleRepoInstallation,
    );
    await Promise.all(
      updates.map((u) =>
        this.prisma.project.update({
          where: { id: u.projectId },
          data: {
            installationId: u.installationId,
            installationStatus: u.installationStatus,
          },
        }),
      ),
    );
  }

  async listProjects(userId: string) {
    const projects = await this.prisma.project.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
    return projects.map((p) => ({ ...p, githubRepoId: Number(p.githubRepoId) }));
  }

  async addProject(userId: string, repo: RepoSummary & { installationId: number }) {
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
        installationId: repo.installationId,
        installationStatus: 'active',
      },
      // Re-marcar um repo já gerenciado atualiza a instalação corrente
      // (pode ter reinstalado noutra conta/instalação).
      update: { installationId: repo.installationId, installationStatus: 'active' },
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

  /** URL de instalação/gestão do App no GitHub (CTA "Instalar em mais repos"). */
  installUrl(): { url: string } {
    const slug = process.env.GITHUB_APP_SLUG;
    if (!slug) throw new NotFoundException('GITHUB_APP_SLUG não configurado');
    return { url: `https://github.com/apps/${slug}/installations/new` };
  }
}
