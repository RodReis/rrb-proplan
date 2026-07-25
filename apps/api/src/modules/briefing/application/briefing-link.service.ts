import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import {
  generateToken,
  hashToken,
  linkStatus,
  type LinkStatus,
} from '../domain/briefing-token';

export interface CreatedLink {
  id: string;
  /** Token em claro — devolvido UMA ÚNICA VEZ, nunca persistido nem relido. */
  token: string;
  expiresAt: Date | null;
}

@Injectable()
export class BriefingLinkService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Gera (ou regenera) o link de um projeto de cliente.
   *
   * Regenerar **revoga o anterior**: dois links vivos para o mesmo projeto
   * significaria que revogar um não fecha o acesso, que é o oposto do que
   * "revogar" promete.
   *
   * Roda sob o contexto de tenant aberto pelo interceptor (rota `/t/:tenant`).
   */
  async createOrRegenerate(
    tenantId: string,
    clientProjectId: string,
    expiresAt?: Date | null,
  ): Promise<CreatedLink> {
    await this.assertProject(tenantId, clientProjectId);

    const token = generateToken();
    const tokenHash = hashToken(token);
    const now = new Date();

    // Interativa, não lote: sob contexto de tenant o lote sairia em duas
    // conexões (issue #113 e `batch-transaction.arch.spec.ts`).
    const link = await this.prisma.$transaction(async (tx) => {
      await tx.briefingLink.updateMany({
        where: { clientProjectId, revokedAt: null },
        data: { revokedAt: now },
      });
      return tx.briefingLink.create({
        data: { clientProjectId, tokenHash, expiresAt: expiresAt ?? null },
      });
    });

    await this.audit(tenantId, 'briefing_link.created', clientProjectId, {
      linkId: link.id,
    });

    // O token em claro só existe aqui e na resposta. Nem log, nem AuditEvent.
    return { id: link.id, token, expiresAt: link.expiresAt };
  }

  async revoke(tenantId: string, clientProjectId: string) {
    await this.assertProject(tenantId, clientProjectId);
    const { count } = await this.prisma.briefingLink.updateMany({
      where: { clientProjectId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    await this.audit(tenantId, 'briefing_link.revoked', clientProjectId, { count });
    return { revoked: count };
  }

  async setExpiration(
    tenantId: string,
    clientProjectId: string,
    expiresAt: Date | null,
  ) {
    await this.assertProject(tenantId, clientProjectId);
    const { count } = await this.prisma.briefingLink.updateMany({
      where: { clientProjectId, revokedAt: null },
      data: { expiresAt },
    });
    if (count === 0) throw new NotFoundException('nenhum link ativo');
    await this.audit(tenantId, 'briefing_link.expiration_set', clientProjectId, {
      expiresAt: expiresAt?.toISOString() ?? null,
    });
    return { updated: count };
  }

  /** Metadados do link ativo — nunca o token (que não é recuperável). */
  async getActive(tenantId: string, clientProjectId: string) {
    await this.assertProject(tenantId, clientProjectId);
    const link = await this.prisma.briefingLink.findFirst({
      where: { clientProjectId, revokedAt: null },
      orderBy: { createdAt: 'desc' },
      select: { id: true, expiresAt: true, createdAt: true },
    });
    if (!link) return { active: false as const };
    return { active: true as const, ...link, status: linkStatus(link) };
  }

  /**
   * Resolução PÚBLICA do token (`GET /b/:token`) — sem sessão.
   *
   * Três regras que esta função existe para cumprir:
   *
   * 1. **O tenant vem do hash do token**, nunca de `workspaceId` no request
   *    (ADR-020 / MVP3 §4). O lookup é global, como a rota `/resolve`.
   * 2. **Não-diferencial**: token inexistente, de outro tenant, expirado ou
   *    revogado não podem ser distinguíveis por quem sonda. Inexistente e
   *    alheio devolvem o MESMO `invalid`; expirado e revogado devolvem o
   *    próprio estado porque quem tem um link legítimo precisa saber por que
   *    ele parou de funcionar — mas nenhum dos quatro vaza tenant ou projeto.
   * 3. **Acesso auditado** — inclusive as tentativas inválidas.
   *
   * Roda FORA do contexto de tenant (a rota pública não tem `/t/:tenant`), então
   * abre o próprio `runInTenantContext` só depois de descobrir o tenant pelo
   * hash — e apenas para gravar a auditoria.
   */
  async resolvePublic(token: string): Promise<{ status: LinkStatus }> {
    // Sem contexto de tenant, o RLS de `briefing_links` é fail-closed. Por isso
    // o lookup usa `$queryRaw` com a role de app: precisamos descobrir o tenant
    // ANTES de poder abrir o contexto — o mesmo problema que a rota `/resolve`
    // tem, resolvido do mesmo jeito (lookup global explícito, ADR-020).
    const tokenHash = hashToken(token);
    const rows = await this.prisma.$queryRaw<
      Array<{
        id: string;
        expires_at: Date | null;
        revoked_at: Date | null;
        tenant_id: string;
        client_project_id: string;
      }>
    >`
      SELECT bl.id, bl.expires_at, bl.revoked_at, c.tenant_id, bl.client_project_id
      FROM briefing_links bl
      JOIN client_projects cp ON cp.id = bl.client_project_id
      JOIN clients c ON c.id = cp.client_id
      WHERE bl.token_hash = ${tokenHash}
        AND cp.deleted_at IS NULL
        AND c.deleted_at IS NULL
      LIMIT 1
    `;

    const row = rows[0];
    const status = linkStatus(
      row ? { expiresAt: row.expires_at, revokedAt: row.revoked_at } : null,
    );

    if (row) {
      // Auditoria do acesso, já sob o contexto do tenant descoberto pelo hash.
      await this.prisma.runInTenantContext([row.tenant_id], async () => {
        await this.prisma.auditEvent.create({
          data: {
            tenantId: row.tenant_id,
            kind: 'briefing_link.accessed',
            subject: row.client_project_id,
            payload: { status, linkId: row.id },
          },
        });
      });
    }

    // Só o estado. Nada de tenant, projeto, cliente ou id — quem sonda tokens
    // não pode aprender nada além de "este não serve".
    return { status };
  }

  /** Existe e é deste tenant? 404 não-diferencial para alheio e inexistente. */
  private async assertProject(tenantId: string, clientProjectId: string) {
    const project = await this.prisma.clientProject.findFirst({
      where: {
        id: clientProjectId,
        deletedAt: null,
        client: { tenantId, deletedAt: null },
      },
      select: { id: true },
    });
    if (!project) throw new NotFoundException('projeto não encontrado');
  }

  /** Ver `ClientsService.audit`: perder o evento é melhor que desfazer o fato. */
  private async audit(
    tenantId: string,
    kind: string,
    subject: string,
    payload: Prisma.InputJsonValue,
  ) {
    try {
      await this.prisma.auditEvent.create({
        data: { tenantId, kind, subject, payload },
      });
    } catch {
      // ponytail: silencioso de propósito, como no ClientsService.
    }
  }
}
