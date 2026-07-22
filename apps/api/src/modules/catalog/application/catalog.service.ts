import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { GithubAuth } from '../../identity/application/github-auth.service';
import {
  GithubInstallationsClient,
  Installation,
} from '../../identity/infrastructure/github-installations.client';
import { IngestionService } from '../../ingestion/application/ingestion.service';
import { MembershipService } from '../../identity/application/membership.service';
import { RoleSyncService } from '../../identity/application/role-sync.service';
import { SettingsService } from '../../settings/application/settings.service';
import { computeFreshness, Freshness } from '../domain/freshness';
import { reconcileInstallations } from '../domain/installation-reconcile';
import { reconcileTenantInstallations } from '../domain/tenant-reconcile';
import { GithubClient, RepoSummary } from '../infrastructure/github.client';

export interface RepoWithManaged extends RepoSummary {
  installationId: number;
  managedProjectId: string | null;
}

/** Um grupo do catálogo = uma instalação do App em uma conta (ADR-015). */
export interface InstallationGroup {
  installationId: number;
  /** Tenant 1:1 com a instalação (SPEC-022). null = instalação ainda sem tenant
   *  (ex.: App instalado mas ainda não reconciliado — PR-5). O front usa para a
   *  rota /t/:tenant ao abrir um projeto do grupo. */
  tenantId: string | null;
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
  private readonly logger = new Logger(CatalogService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auth: GithubAuth,
    private readonly github: GithubClient,
    private readonly installationsClient: GithubInstallationsClient,
    private readonly ingestion: IngestionService,
    private readonly settings: SettingsService,
    private readonly roleSync: RoleSyncService,
    private readonly membership: MembershipService,
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
  /**
   * Tenants de que o usuário é membro (SPEC-022 E1, ADR-020). Alimenta o
   * contexto RLS `app.tenant_ids` da rota global do catálogo, que lê projetos
   * cross-tenant SOB RLS (jamais bypass). `memberships` não tem policy de tenant
   * — é a fonte da própria autorização — então esta leitura roda no client base.
   * O array vem do `userId` AUTENTICADO, nunca de input do cliente.
   */
  private async membershipTenantIds(userId: string): Promise<string[]> {
    const rows = await this.prisma.membership.findMany({
      where: { userId },
      select: { tenantId: true },
    });
    return rows.map((r) => r.tenantId);
  }

  async listInstallations(userId: string): Promise<CatalogInstallations> {
    const token = await this.auth.userToken(userId);
    const installations = await this.installationsClient.list(token);
    const tenantIds = await this.membershipTenantIds(userId);

    // Leitura de projetos sob contexto multi-tenant (array de membership): a rota
    // global lê cross-tenant sem desligar RLS (E1). Sem membership → array vazio
    // → fail-closed (nenhum projeto), nunca "todos".
    const [projects, reposByInstallation] = await Promise.all([
      this.prisma.withTenant(tenantIds, (tx) =>
        tx.project.findMany({ where: { userId } }),
      ),
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

    // Reinstall re-liga (SPEC-022): o installationId muda a cada reinstall, então
    // os tenants do usuário são reconciliados por id de conta ANTES de montar o
    // mapa — senão o tenant existente não seria encontrado e o front abriria sem
    // tenant. Restrito aos tenants de membership: nunca varre a tabela inteira.
    await this.relinkTenants(tenantIds, installations);

    // Instalação visível ainda SEM tenant ganha um agora (SPEC-022 decisões 1 e
    // 3). Roda DEPOIS do re-liga: se a conta já tem tenant com id de instalação
    // antigo, o re-liga acabou de reconciliá-lo e nada é criado aqui. Sem este
    // passo, um banco novo (sem o backfill da migration) deixa o usuário sem
    // tenant nenhum — `app.tenant_ids` vazio e RLS barrando toda escrita.
    await this.membership.ensureTenants(userId, installations);

    // Recarrega: `tenantIds` foi lido ANTES do ensureTenants e, no primeiro
    // acesso, estaria vazio — o `applyReconcile` abaixo escreve sob esse array e
    // seria barrado pelo RLS. Uma segunda leitura barata evita que a correção só
    // valha a partir da 2ª abertura do catálogo.
    const effectiveTenantIds = await this.membershipTenantIds(userId);

    // Mapa installationId → tenantId (1:1, SPEC-022): o front precisa do tenant
    // para montar a rota /t/:tenant ao abrir um projeto. `memberships`/`tenants`
    // não têm RLS de tenant — leitura no client base.
    const tenantsByInstallation = new Map<number, string>();
    const tenantRows = await this.prisma.tenant.findMany({
      where: { installationId: { in: installations.map((i) => i.id) } },
      select: { id: true, installationId: true },
    });
    for (const t of tenantRows) {
      if (t.installationId !== null) tenantsByInstallation.set(t.installationId, t.id);
    }

    // Recálculo do papel a partir do GitHub (SPEC-022 E2, decisão 2): aqui, na
    // listagem — nunca no sync de docs. Roda DEPOIS do re-liga, quando os
    // tenants já casam com as instalações vivas. O `identity` decide o papel;
    // o catalog só dispara e não conhece `Membership` (ADR-001).
    await this.syncRolesFor(userId, token, installations, tenantsByInstallation);

    // Mapa repoId → installationId visível agora, para reconciliar status.
    const visibleRepoInstallation = new Map<string, number>();
    for (const { inst, repos } of reposByInstallation) {
      for (const r of repos) {
        visibleRepoInstallation.set(r.githubRepoId.toString(), inst.id);
      }
    }
    await this.applyReconcile(projects, visibleRepoInstallation, effectiveTenantIds);

    const groups: InstallationGroup[] = reposByInstallation.map(({ inst, repos }) => ({
      installationId: inst.id,
      tenantId: tenantsByInstallation.get(inst.id) ?? null,
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

  /**
   * Reinstall re-liga, não recria (SPEC-022, §Notas técnicas). Re-aponta
   * `installationId` no tenant EXISTENTE quando o GitHub emite um id novo, e
   * preenche/atualiza `accountId`/`accountLogin`. Casamento por id de conta —
   * o login muda num rename e criaria um tenant duplicado, orfanando os dados.
   *
   * `tenants` não tem policy de tenant (é a fonte da própria autorização), então
   * roda no client base — mas escopado aos tenants de membership do usuário,
   * nunca à tabela inteira.
   */
  private async relinkTenants(
    tenantIds: string[],
    installations: Installation[],
  ): Promise<void> {
    if (tenantIds.length === 0 || installations.length === 0) return;

    const tenants = await this.prisma.tenant.findMany({
      where: { id: { in: tenantIds } },
      select: { id: true, installationId: true, accountId: true, accountLogin: true },
    });

    const relinks = reconcileTenantInstallations(
      tenants,
      installations.map((i) => ({
        installationId: i.id,
        accountId: i.account.id,
        accountLogin: i.account.login,
      })),
    );

    for (const r of relinks) {
      try {
        await this.prisma.tenant.update({
          where: { id: r.tenantId },
          data: {
            installationId: r.installationId,
            accountId: r.accountId,
            accountLogin: r.accountLogin,
          },
        });
      } catch (e) {
        // O re-liga é best-effort dentro de uma rota de LEITURA: falhar aqui não
        // pode derrubar o catálogo inteiro. `installationId`/`accountId` são
        // @unique — duas requests concorrentes podem colidir (P2002), e nesse
        // caso a outra já gravou o que esta tentava gravar. Segue: o estado
        // converge na próxima leitura (a reconciliação é idempotente).
        if (
          e instanceof Prisma.PrismaClientKnownRequestError &&
          e.code === 'P2002'
        ) {
          this.logger.warn(
            `Re-liga do tenant ${r.tenantId} colidiu (P2002) — outra request reconciliou antes; seguindo.`,
          );
          continue;
        }
        throw e;
      }
    }
  }

  /**
   * Dispara o recálculo de papel (SPEC-022 E2). Best-effort: a listagem do
   * catálogo é rota de leitura e não pode cair porque o GitHub não respondeu.
   */
  private async syncRolesFor(
    userId: string,
    token: string,
    installations: Installation[],
    tenantsByInstallation: Map<number, string>,
  ): Promise<void> {
    const accounts = installations
      .map((i) => ({
        tenantId: tenantsByInstallation.get(i.id),
        accountLogin: i.account.login,
        accountType: i.account.type as string,
      }))
      .filter(
        (a): a is { tenantId: string; accountLogin: string; accountType: string } =>
          a.tenantId !== undefined,
      );
    if (accounts.length === 0) return;

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { login: true },
    });
    if (!user) return;

    try {
      await this.roleSync.syncRoles(userId, user.login, token, accounts);
    } catch (e) {
      this.logger.warn(
        `Recálculo de papel falhou: ${e instanceof Error ? e.message : e}`,
      );
    }
  }

  /** Persiste o diff de installationStatus/id calculado pelo domínio. */
  private async applyReconcile(
    projects: { id: string; githubRepoId: bigint; installationId: number | null; installationStatus: 'active' | 'missing' }[],
    visibleRepoInstallation: Map<string, number>,
    tenantIds: string[],
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
    if (updates.length === 0) return;
    // UPDATE também é escopado por RLS — roda sob o contexto de membership.
    await this.prisma.withTenant(tenantIds, (tx) =>
      Promise.all(
        updates.map((u) =>
          tx.project.update({
            where: { id: u.projectId },
            data: {
              installationId: u.installationId,
              installationStatus: u.installationStatus,
            },
          }),
        ),
      ),
    );
  }

  async listProjects(userId: string) {
    const tenantIds = await this.membershipTenantIds(userId);
    const projects = await this.prisma.withTenant(tenantIds, (tx) =>
      tx.project.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
      }),
    );
    return projects.map((p) => ({ ...p, githubRepoId: Number(p.githubRepoId) }));
  }

  async addProject(userId: string, repo: RepoSummary & { installationId: number }) {
    // O projeto NASCE dentro de um tenant (SPEC-022): `projects` tem policy de
    // RLS `tenant_id = ANY(app.tenant_ids)`, que — sem WITH CHECK próprio — vale
    // também para o INSERT. Gravar sem `tenantId`, ou fora do `withTenant`,
    // resulta em 42501 ("new row violates row-level security policy"). O tenant
    // sai da instalação (relação 1:1) que o front já envia no corpo.
    const tenant = await this.prisma.tenant.findUnique({
      where: { installationId: repo.installationId },
      select: { id: true },
    });
    if (!tenant) {
      throw new NotFoundException(
        'Instalação sem tenant — abra o catálogo para reconciliar antes de gerenciar o repositório.',
      );
    }

    // Membership confere que o usuário pertence AO tenant da instalação: sem
    // isso, o `tenantId` viria do corpo da request por via indireta e um usuário
    // poderia criar projeto no tenant de outro (o RLS barraria, mas a checagem
    // explícita dá o 404 correto em vez de um 500 opaco).
    const membershipTenantIds = await this.membershipTenantIds(userId);
    if (!membershipTenantIds.includes(tenant.id)) {
      throw new NotFoundException('Instalação não pertence a nenhum tenant seu');
    }

    const existing = await this.prisma.withTenant(membershipTenantIds, (tx) =>
      tx.project.findUnique({
        where: {
          userId_githubRepoId: {
            userId,
            githubRepoId: BigInt(repo.githubRepoId),
          },
        },
        select: { id: true },
      }),
    );

    const project = await this.prisma.withTenant(membershipTenantIds, (tx) =>
      tx.project.upsert({
        where: {
          userId_githubRepoId: {
            userId,
            githubRepoId: BigInt(repo.githubRepoId),
          },
        },
        create: {
          userId,
          tenantId: tenant.id,
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
      }),
    );

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
