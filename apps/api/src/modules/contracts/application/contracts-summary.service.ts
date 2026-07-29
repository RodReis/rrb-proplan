import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';

export interface UnacceptedContract {
  contractId: string;
  clientProjectId: string;
  title: string;
  version: number;
  since: string;
}

export interface ContractCounts {
  /** Emitidos no período. */
  issued: number;
  /** Destes, quantos já têm aceite registrado. */
  accepted: number;
  /**
   * O tenant já emitiu **algum** contrato, em qualquer época?
   *
   * É o que separa *"0 contratos no período"* de *"você ainda não emitiu
   * contrato"* (§2.7). Sem este campo, `issued: 0` significa as duas coisas — e
   * o §5 chama isso de o defeito mais provável desta tela.
   */
  hasAny: boolean;
}

/**
 * A superfície que o `dashboard` consome do `contracts` (SPEC-035 §6).
 *
 * O `ContractIssueService.list` é **por projeto**; aqui a pergunta é por tenant.
 * Só leitura — emitir e registrar aceite continuam nos services deles.
 */
@Injectable()
export class ContractsSummaryService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Contratos emitidos sem aceite registrado — 3º item de *Esperando você*
   * (§2.3).
   *
   * O aceite é registrado pelo **prestador** no painel (SPEC-034 §2.10), nunca
   * pelo cliente na rota pública. Então "sem aceite" é literalmente trabalho
   * esperando por quem olha este dashboard.
   */
  async unaccepted(tenantId: string): Promise<UnacceptedContract[]> {
    const linhas = await this.prisma.contract.findMany({
      where: {
        tenantId,
        acceptedAt: null,
        clientProject: { deletedAt: null, client: { deletedAt: null } },
      },
      include: { clientProject: { select: { title: true } } },
      orderBy: { createdAt: 'asc' },
    });

    return linhas.map((c) => ({
      contractId: c.id,
      clientProjectId: c.clientProjectId,
      title: c.clientProject.title,
      version: c.version,
      since: c.createdAt.toISOString(),
    }));
  }

  /**
   * Contagem de contratos no período, mais o `hasAny` que distingue zero de
   * ausência (§2.7).
   *
   * `hasAny` ignora o período de propósito: a pergunta que ele responde é
   * *"esta funcionalidade já foi usada alguma vez"*, e um recorte de 30 dias
   * responderia outra coisa.
   */
  async counts(tenantId: string, desde: Date): Promise<ContractCounts> {
    const projetoVivo = { clientProject: { deletedAt: null, client: { deletedAt: null } } };

    const [issued, accepted, total] = await Promise.all([
      this.prisma.contract.count({
        where: { tenantId, createdAt: { gte: desde }, ...projetoVivo },
      }),
      this.prisma.contract.count({
        where: {
          tenantId,
          createdAt: { gte: desde },
          acceptedAt: { not: null },
          ...projetoVivo,
        },
      }),
      this.prisma.contract.count({ where: { tenantId, ...projetoVivo } }),
    ]);

    return { issued, accepted, hasAny: total > 0 };
  }
}
