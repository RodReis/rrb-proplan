import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';

export interface TenantActivityEntry {
  kind: 'audit' | 'sync';
  at: string;
  /** Rótulo curto do que aconteceu. */
  detail: string;
  /** Projeto de repo, quando a trilha é de sync. `null` na auditoria. */
  projectId: string | null;
}

/**
 * Duas das três trilhas de *"O que andou por aqui"* (SPEC-035 §2.2) — a
 * terceira (`client_status_transitions`) é do `clients`, dono dela.
 *
 * ## Por que o bloco é do TENANT e não do usuário (§7.1)
 *
 * A #150 pedia a trilha *filtrada pelo `userId`*. Ao conferir o schema, **só
 * `client_status_transitions` tem `actor_user_id`** — `AuditEvent` tem
 * `tenantId`, `kind`, `subject`, `payload`, `at`, e `SyncRun` idem. Nenhuma
 * coluna de ator.
 *
 * A saída escolhida foi **atividade do tenant, com rótulo honesto**: zero
 * migração, usa as três trilhas, e com um usuário por workspace o resultado é o
 * mesmo. Muda o rótulo, não o conteúdo. Adicionar `actor_user_id` "para o
 * futuro" e não preencher no presente é a armadilha do `LlmUsage.tenant_id`,
 * que nasceu na Fatia 8 e ficou nulo até a Fatia 21 achar o problema.
 *
 * **Gatilho de revisão**: tenant com 2+ membros ativos — aí a distinção passa a
 * existir de verdade e a coluna volta à mesa, como fatia própria.
 *
 * Só leitura.
 */
@Injectable()
export class ActivitySummaryService {
  constructor(private readonly prisma: PrismaService) {}

  /** Eventos de auditoria do tenant no período. */
  async recentAudit(
    tenantId: string,
    desde: Date,
    take: number,
  ): Promise<TenantActivityEntry[]> {
    const linhas = await this.prisma.auditEvent.findMany({
      where: { tenantId, at: { gte: desde } },
      orderBy: { at: 'desc' },
      take,
      select: { kind: true, subject: true, at: true },
    });

    return linhas.map((e) => ({
      kind: 'audit' as const,
      at: e.at.toISOString(),
      detail: `${e.kind}: ${e.subject}`,
      projectId: null,
    }));
  }

  /**
   * Syncs de repositório do tenant no período.
   *
   * **`noop` fica de fora**, mesmo padrão do `feed` do painel: sync que não
   * mudou nada não é notícia, e incluí-los encheria a retomada de "nada mudou"
   * — que é o oposto de responder *"o que andou por aqui"*.
   */
  async recentSyncs(
    tenantId: string,
    desde: Date,
    take: number,
  ): Promise<TenantActivityEntry[]> {
    const linhas = await this.prisma.syncRun.findMany({
      where: {
        startedAt: { gte: desde },
        status: { not: 'noop' },
        project: { tenantId },
      },
      orderBy: { startedAt: 'desc' },
      take,
      select: {
        id: true,
        projectId: true,
        status: true,
        added: true,
        updated: true,
        removed: true,
        startedAt: true,
        project: { select: { owner: true, name: true } },
      },
    });

    return linhas.map((s) => ({
      kind: 'sync' as const,
      at: s.startedAt.toISOString(),
      detail: `${s.project.owner}/${s.project.name}: +${s.added} ~${s.updated} -${s.removed}`,
      projectId: s.projectId,
    }));
  }
}
