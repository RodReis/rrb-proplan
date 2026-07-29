import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';

export interface PendingEstimate {
  clientProjectId: string;
  /** Cliente dono — o drill-down do dashboard abre a gaveta dele (§7.3). */
  clientId: string;
  title: string;
  /**
   * `missing` = briefing recebido e nenhuma estimativa gerada.
   * `unapproved` = estimativa gerada e ainda não aprovada.
   *
   * Os dois esperam a mesma pessoa, mas pedem ações diferentes — e a tela
   * precisa dizer qual. "Pendente" sem dizer o quê obriga a abrir o card para
   * descobrir, que é o oposto de uma tela de retomada.
   */
  reason: 'missing' | 'unapproved';
  since: string;
}

/**
 * A superfície que o `dashboard` consome do `estimates` (SPEC-035 §6).
 *
 * Só leitura. O agregador não consulta `estimates` nem `briefing_versions`
 * direto (ADR-001).
 */
@Injectable()
export class EstimatesSummaryService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * 2º item de *Esperando você* (§2.3): **briefing recebido sem estimativa
   * gerada, ou estimativa gerada sem aprovação**.
   *
   * Os dois casos numa consulta só porque são o mesmo fato para quem olha a
   * tela — *"este projeto travou antes do contrato"*. O `reason` preserva a
   * distinção sem duplicar a linha, e sem que o contador conte o mesmo projeto
   * duas vezes: um projeto entra **uma vez**, ainda que tenha briefing novo e
   * estimativa velha não aprovada.
   *
   * Ponto de partida é o **briefing enviado**, não o projeto: sem briefing não
   * há o que estimar, e listar projeto em rascunho como "esperando estimativa"
   * inflaria o contador com trabalho que ainda não é possível fazer.
   */
  async pending(tenantId: string): Promise<PendingEstimate[]> {
    const briefings = await this.prisma.briefingVersion.findMany({
      where: {
        clientProject: {
          deletedAt: null,
          client: { tenantId, deletedAt: null },
          // Entregue e arquivado não esperam mais estimativa — é o fim normal.
          state: { notIn: ['DELIVERED', 'ARCHIVED'] },
        },
      },
      select: {
        submittedAt: true,
        clientProjectId: true,
        clientProject: { select: { title: true, clientId: true } },
      },
      orderBy: { submittedAt: 'asc' },
    });

    if (briefings.length === 0) return [];

    const projetoIds = [...new Set(briefings.map((b) => b.clientProjectId))];
    const estimativas = await this.prisma.estimate.findMany({
      where: { tenantId, clientProjectId: { in: projetoIds } },
      select: { clientProjectId: true, approvedAt: true, createdAt: true },
    });

    // Um projeto pode ter várias estimativas (refazer gera v2). Aprovada
    // qualquer uma, o projeto sai da lista: o que espera é a DECISÃO, e ela já
    // foi tomada.
    const temAprovada = new Set(
      estimativas.filter((e) => e.approvedAt !== null).map((e) => e.clientProjectId),
    );
    const temAlguma = new Set(estimativas.map((e) => e.clientProjectId));

    const out: PendingEstimate[] = [];
    const jaListado = new Set<string>();
    for (const b of briefings) {
      const id = b.clientProjectId;
      if (jaListado.has(id) || temAprovada.has(id)) continue;
      jaListado.add(id);
      out.push({
        clientProjectId: id,
        clientId: b.clientProject.clientId,
        title: b.clientProject.title,
        reason: temAlguma.has(id) ? 'unapproved' : 'missing',
        since: b.submittedAt.toISOString(),
      });
    }
    return out;
  }
}
