import {
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';

/**
 * A aba de erros do admin (SPEC-043 §Escopo) — lista, agrupa, detalha e triage.
 *
 * ## O e-mail do comprador é resolvido AQUI, na leitura
 *
 * `lic_error_reports` não tem coluna de e-mail (§Notas técnicas): o app nem
 * conhece o e-mail da compra, e copiá-lo para a tabela criaria uma segunda
 * morada do dado pessoal — que a exclusão a pedido teria de lembrar de limpar e
 * que o purge de 90 dias manteria viva enquanto o relato vivesse. O JOIN com
 * `licenses` responde a mesma pergunta e mantém uma fonte só.
 *
 * **`contactEmail` é outro campo e aparece separado na tela.** Um é o comprador
 * (correlacionado), outro é quem digitou um e-mail para retorno — podem ser
 * pessoas diferentes, e fundi-los num campo só faria o operador responder ao
 * endereço errado.
 *
 * ## O purge mora aqui, e ainda não é agendado
 *
 * Método chamável. O repo **passou a ter agendador** no ADR-029 (Fatia 36), e o
 * `LicenseExpirySweepService` — que estava exatamente nesta situação — virou
 * recorrente na SPEC-048. Este não entrou junto para não empacotar duas coisas
 * num card: é o `[FIX]` **#271**, com o comportamento correto já escrito (90
 * dias, o que apagar, o mecanismo) e três exemplos de scheduler a copiar.
 *
 * **A diferença de gravidade em relação ao sweep vale registrar**: lá, o job
 * parado só deixa a lista do admin desatualizada; aqui, ele parado significa
 * retenção de 90 dias não cumprida, que é mitigação de LGPD assumida com o PI.
 * Por isso existe botão no admin enquanto o card não é feito.
 */

const MAX_PAGE = 100;
/** §Escopo: relatos com mais de 90 dias são apagados. */
export const RETENCAO_DIAS = 90;

export interface ErrorReportListItem {
  id: string;
  message: string;
  appVersion: string;
  os: string;
  source: string;
  status: string;
  occurredAt: Date;
  receivedAt: Date;
  licenseId: string;
}

export interface ErrorReportGroup {
  message: string;
  count: number;
  /** O mais recente do grupo — é por ele que o operador decide o que olhar. */
  lastReceivedAt: Date;
}

export interface ErrorReportFilters {
  productId?: string;
  appVersion?: string;
  status?: string;
  take?: number;
}

@Injectable()
export class ErrorReportAdminService {
  private readonly logger = new Logger(ErrorReportAdminService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Lista com filtros (§Escopo): produto, versão e status.
   *
   * **Produto filtra por JOIN**, não por coluna nossa: o relato conhece a
   * licença, a licença a edição, a edição o produto. Denormalizar `productId`
   * para cá economizaria o JOIN e criaria a chance de a coluna discordar do
   * caminho — o mesmo tipo de segunda fonte que o e-mail evita.
   */
  async list(filtros: ErrorReportFilters = {}): Promise<ErrorReportListItem[]> {
    return this.prisma.licErrorReport.findMany({
      where: {
        status: filtros.status ? (filtros.status as never) : undefined,
        appVersion: filtros.appVersion || undefined,
        license: filtros.productId
          ? { edition: { productId: filtros.productId } }
          : undefined,
      },
      select: {
        id: true,
        message: true,
        appVersion: true,
        os: true,
        source: true,
        status: true,
        occurredAt: true,
        receivedAt: true,
        licenseId: true,
      },
      // `receivedAt` e não `occurredAt`: a ordem da lista não pode depender do
      // relógio da máquina de outra pessoa. Um cliente com data adiantada
      // fixaria o relato dele no topo para sempre.
      orderBy: { receivedAt: 'desc' },
      take: Math.min(Math.max(1, filtros.take ?? 50), MAX_PAGE),
    });
  }

  /**
   * Agrupamento por `message` com contagem (§Escopo) — *"qual erro acontece
   * mais?"*.
   *
   * `groupBy` no banco, não `reduce` sobre a lista: agrupar em memória contaria
   * só as N linhas que a paginação trouxe, e o número na tela seria menor que a
   * realidade sem nada indicar isso.
   */
  async groups(filtros: ErrorReportFilters = {}): Promise<ErrorReportGroup[]> {
    const linhas = await this.prisma.licErrorReport.groupBy({
      by: ['message'],
      where: {
        status: filtros.status ? (filtros.status as never) : undefined,
        appVersion: filtros.appVersion || undefined,
        license: filtros.productId
          ? { edition: { productId: filtros.productId } }
          : undefined,
      },
      _count: { _all: true },
      _max: { receivedAt: true },
      orderBy: { _count: { message: 'desc' } },
      take: MAX_PAGE,
    });

    return linhas.map((l) => ({
      message: l.message,
      count: l._count._all,
      lastReceivedAt: l._max.receivedAt ?? new Date(0),
    }));
  }

  /**
   * Um relato, com stack, sessionTail e **o e-mail do comprador correlacionado**
   * (§Critérios de aceite).
   */
  async detail(id: string) {
    const relato = await this.prisma.licErrorReport.findUnique({
      where: { id },
      include: {
        license: {
          select: {
            id: true,
            // A correlação server-side que a spec pede. Vem do JOIN, nunca de
            // uma cópia nossa.
            customerEmail: true,
            customerName: true,
            status: true,
            edition: {
              select: { slug: true, product: { select: { id: true, name: true } } },
            },
          },
        },
      },
    });

    // Sob RLS, relato de outro tenant já volta `null` — `404` é "não existe para
    // você", que é a resposta certa nos dois casos.
    if (!relato) throw new NotFoundException('Relato não encontrado');
    return relato;
  }

  /**
   * Move o relato entre `NEW` / `TRIAGED` / `RESOLVED`.
   *
   * Sem carimbo de autor, ao contrário da revogação e da extensão: aqueles
   * mexem no que o cliente comprou e alguém vai ter de explicar seis meses
   * depois; este é organização interna da fila de bugs. Se um dia a triagem
   * virar compromisso com o cliente, aí sim vira evento carimbado.
   */
  async setStatus(id: string, status: unknown): Promise<{ id: string; status: string }> {
    const alvo = typeof status === 'string' ? status.toUpperCase() : '';
    if (!['NEW', 'TRIAGED', 'RESOLVED'].includes(alvo)) {
      throw new UnprocessableEntityException(
        '`status` deve ser `new`, `triaged` ou `resolved`',
      );
    }

    const existente = await this.prisma.licErrorReport.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!existente) throw new NotFoundException('Relato não encontrado');

    const atualizado = await this.prisma.licErrorReport.update({
      where: { id },
      data: { status: alvo as never },
      select: { id: true, status: true },
    });

    return atualizado;
  }

  /**
   * Apaga relatos com mais de 90 dias (§Escopo). Devolve quantos saíram.
   *
   * **`agora` é parâmetro, não `new Date()` interno** — é o que torna a retenção
   * testável com relógio controlado, que é critério de aceite. Um teste que
   * dependesse do relógio real só conseguiria provar a regra criando linha com
   * data de 91 dias atrás e torcendo para o dia não virar no meio da execução.
   *
   * **Apaga, não anonimiza.** A exclusão a pedido preserva a transação porque o
   * fato da venda importa; aqui não há fato a preservar — um crash de três meses
   * atrás num app que já foi corrigido é ruído, e a spec pede minimização.
   *
   * Roda sob contexto do tenant: fora dele o `deleteMany` do RLS fail-closed
   * apagaria zero linhas **sem erro**, e o purge reportaria sucesso tendo
   * mantido tudo — que aqui significa retenção de LGPD descumprida em silêncio.
   */
  async purge(tenantId: string, agora: Date = new Date()): Promise<number> {
    const corte = new Date(agora.getTime() - RETENCAO_DIAS * 24 * 60 * 60 * 1000);

    const { count } = await this.prisma.runInTenantContext([tenantId], () =>
      this.prisma.licErrorReport.deleteMany({
        // `receivedAt`, não `occurredAt`: a retenção conta do que está aqui. Um
        // relógio adiantado no cliente não pode empurrar o relato para fora da
        // janela antes da hora, nem um atrasado mantê-lo além dela.
        where: { receivedAt: { lt: corte } },
      }),
    );

    if (count > 0) {
      this.logger.log(`Tenant ${tenantId}: ${count} relato(s) de erro apagado(s) pelo purge`);
    }
    return count;
  }
}
