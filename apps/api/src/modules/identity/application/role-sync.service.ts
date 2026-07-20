import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { deriveRole } from '../domain/role-derivation';
import { GithubOrgMembershipClient } from '../infrastructure/github-org-membership.client';

/**
 * Janela do throttle (SPEC-022 E2, decisão 2). Abaixo disso, a abertura do
 * catálogo NÃO consulta o GitHub — o papel do banco é usado como está.
 * 15min: o papel muda raramente (alguém entra/sai de uma org), e o custo é
 * 1 request por org por recálculo.
 */
const THROTTLE_MS = 15 * 60 * 1000;

/** Uma conta/instalação vista agora, com o tenant que o ProPlan já conhece. */
export interface TenantAccount {
  tenantId: string;
  accountLogin: string;
  accountType: string;
}

/**
 * Recálculo do papel a partir do GitHub (SPEC-022, emenda E2).
 *
 * Roda na listagem de instalações (decisão 2) — nunca no sync de docs. Mora no
 * `identity` porque papel é autorização: o `catalog` apenas dispara, e não
 * conhece `Membership` (ADR-001).
 */
@Injectable()
export class RoleSyncService {
  private readonly logger = new Logger(RoleSyncService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly orgMembership: GithubOrgMembershipClient,
  ) {}

  /**
   * Recalcula o papel do usuário nos tenants informados. Best-effort: falha
   * aqui não pode derrubar a listagem do catálogo, que é uma rota de leitura.
   *
   * @param now injetável para teste — `Date.now()` real em produção.
   */
  async syncRoles(
    userId: string,
    userLogin: string,
    userToken: string,
    accounts: TenantAccount[],
    now: Date = new Date(),
  ): Promise<void> {
    if (accounts.length === 0) return;

    const memberships = await this.prisma.membership.findMany({
      where: { userId, tenantId: { in: accounts.map((a) => a.tenantId) } },
      select: { id: true, tenantId: true, role: true, roleSyncedAt: true },
    });
    const byTenant = new Map(memberships.map((m) => [m.tenantId, m]));

    for (const account of accounts) {
      const membership = byTenant.get(account.tenantId);
      if (!membership) continue; // não é membro: nada a recalcular

      // Throttle (decisão 2): dentro da janela, não fala com o GitHub.
      const last = membership.roleSyncedAt?.getTime() ?? 0;
      if (now.getTime() - last < THROTTLE_MS) continue;

      // Decisão 3: conta pessoal não consulta o GitHub. O `deriveRole` já sabe
      // disso, mas o short-circuit precisa estar AQUI — o critério de aceite é
      // "sem nenhuma chamada a /orgs/.../memberships, conferível em rede".
      const orgRole =
        account.accountType === 'User'
          ? null
          : await this.orgMembership.roleOf(userToken, account.accountLogin, userLogin);

      // Guarda anti-rebaixamento (decisão 4) precisa saber se este é o único
      // owner do tenant.
      const ownerCount = await this.prisma.membership.count({
        where: { tenantId: account.tenantId, role: 'owner' },
      });

      const { role, guarded } = deriveRole({
        accountType: account.accountType,
        orgRole,
        currentRole: membership.role,
        ownerCount,
      });

      if (guarded) {
        this.logger.warn(
          `Papel de ${userLogin} em ${account.accountLogin} seria rebaixado, mas é o único owner do tenant — mantido (SPEC-022 E2, decisão 4).`,
        );
      }

      try {
        await this.prisma.membership.update({
          where: { id: membership.id },
          data: { role, roleSyncedAt: now },
        });
        if (role !== membership.role) {
          this.logger.log(
            `Papel de ${userLogin} em ${account.accountLogin}: ${membership.role} → ${role} (derivado do GitHub).`,
          );
        }
      } catch (e) {
        // Best-effort: a listagem do catálogo não pode cair por causa disto.
        this.logger.warn(
          `Falha ao gravar papel de ${userLogin} em ${account.accountLogin}: ${e instanceof Error ? e.message : e}`,
        );
      }
    }
  }
}
