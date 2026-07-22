import { Injectable } from '@nestjs/common';
import { Role } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';

export interface CurrentMembership {
  tenantId: string;
  role: Role;
}

/**
 * Interface pública do identity para os outros módulos resolverem o vínculo
 * usuário↔tenant e o papel (SPEC-022, ADR-001 — não vaza entidade Prisma).
 */
@Injectable()
export class MembershipService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Membership do usuário no tenant, ou null se não for membro. A resolução
   * roda como owner (fora do escopo RLS) porque `memberships`/`tenants` não têm
   * policy de tenant — são a fonte da própria autorização, não dado escopado.
   */
  async currentMembership(
    userId: string,
    tenantId: string,
  ): Promise<CurrentMembership | null> {
    const m = await this.prisma.membership.findUnique({
      where: { userId_tenantId: { userId, tenantId } },
      select: { tenantId: true, role: true },
    });
    return m ?? null;
  }

  /**
   * Garante `Tenant` + `Membership` para as instalações visíveis do usuário
   * (SPEC-022 decisões 1 e 3).
   *
   * Por que existe: até aqui `Tenant`/`Membership` só nasciam do backfill da
   * migration da Fatia 8 — que converteu os dados que já existiam. Num banco
   * novo (o primeiro deploy em produção) não há o que converter, então o
   * usuário logava sem tenant nenhum, `app.tenant_ids` ficava vazio e o RLS
   * barrava TODA escrita. A própria SPEC-022 registra o furo na emenda E2:
   * *"nada no código cria Tenant/Membership"*.
   *
   * Papel na criação: conta pessoal (`User`) → `owner` por definição, **sem**
   * consultar o GitHub (decisão 3, carve-out explícito). Org → nasce `member`,
   * o piso seguro; o `RoleSyncService` promove a `owner` no mesmo request,
   * derivando do GitHub (decisão 1). Nunca o contrário: nascer `owner` numa org
   * daria privilégio a quem talvez não o tenha.
   *
   * Idempotente: instalação que já tem tenant é ignorada, e o membership usa
   * upsert. Reinstall NÃO passa por aqui — o re-link (`relinkTenants`) roda
   * antes e re-aponta o `installationId` do tenant existente, então a conta já
   * aparece com tenant e nada é criado (nunca duplica nem orfana dados).
   */
  async ensureTenants(
    userId: string,
    installations: readonly {
      id: number;
      account: { id: number; login: string; type: string };
    }[],
  ): Promise<void> {
    if (installations.length === 0) return;

    const known = await this.prisma.tenant.findMany({
      where: {
        OR: [
          { installationId: { in: installations.map((i) => i.id) } },
          { accountId: { in: installations.map((i) => i.account.id) } },
        ],
      },
      select: { id: true, installationId: true, accountId: true },
    });
    const knownInstallations = new Set(
      known.map((t) => t.installationId).filter((v): v is number => v !== null),
    );
    const knownAccounts = new Set(
      known.map((t) => t.accountId).filter((v): v is number => v !== null),
    );

    for (const inst of installations) {
      // Casa por conta TAMBÉM: o tenant pode existir com `installationId` de uma
      // instalação antiga que o re-link ainda não reconciliou.
      if (knownInstallations.has(inst.id) || knownAccounts.has(inst.account.id)) {
        continue;
      }
      await this.prisma.tenant.create({
        data: {
          installationId: inst.id,
          accountId: inst.account.id,
          accountLogin: inst.account.login,
          accountType: inst.account.type,
          memberships: {
            create: {
              userId,
              role: inst.account.type === 'User' ? 'owner' : 'member',
            },
          },
        },
      });
    }

    // Usuário novo numa conta cujo tenant JÁ existe (criado por outro membro):
    // o tenant não entra no laço acima, mas o membership precisa existir, senão
    // esta pessoa fica sem contexto de tenant e o RLS a barra.
    //
    // Só os tenants das instalações que ESTE usuário enxerga — `known` casa por
    // instalação ou por conta, e ambas vêm do `/user/installations` dele, mas o
    // filtro explícito impede que uma futura mudança na consulta vire um
    // membership indevido (fail-closed).
    const visible = new Set<string>();
    for (const t of known) {
      const belongs = installations.some(
        (i) => t.installationId === i.id || t.accountId === i.account.id,
      );
      if (belongs) visible.add(t.id);
    }
    for (const tenantId of visible) {
      await this.prisma.membership.upsert({
        where: { userId_tenantId: { userId, tenantId } },
        create: { userId, tenantId, role: 'member' },
        update: {},
      });
    }
  }
}
