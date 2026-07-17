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
}
