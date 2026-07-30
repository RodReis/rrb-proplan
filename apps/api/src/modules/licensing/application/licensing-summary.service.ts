import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { DEFAULT_PERIOD, type Period, periodStart } from '../domain/period';

/**
 * As contagens do painel de licenciamento (SPEC-040 §Métricas).
 *
 * ## A regra que organiza este arquivo inteiro
 *
 * **Todo número tem teste que prova a origem; número sem teste de origem não
 * entra na tela** (MVP3 §9). Esta é a fatia mais fácil de encher de número
 * bonito — e um número plausível sem origem é pior que nenhum, porque decisões
 * são tomadas sobre ele.
 *
 * ## Receita fica de fora, e o motivo aparece na tela
 *
 * Preço **não é do ProPlan** (decisão #4 do MVP4). Ele vive no `payload` do
 * evento de webhook: sem coluna tipada, sem moeda normalizada e sem garantia de
 * formato entre plataformas. Um total derivado disso seria plausível e
 * indefensável — exatamente o número sem origem que o MVP3 §9 barra. No lugar
 * dele, a tela leva **link para a plataforma**, que é onde dinheiro se confere.
 *
 * O tipo `LicensingSummary` **não tem campo de valor**, e há teste afirmando
 * isso — prova por ausência, mesmo desenho da SPEC-034/035. Acrescentar um
 * `totalCents` aqui um dia seria uma linha inocente e um número indefensável
 * na tela.
 *
 * ## Métrica é contagem sobre coluna tipada, nunca sobre payload
 *
 * As vendas, reembolsos e chargebacks saem de `LicWebhookEvent.eventType` — que
 * é **coluna**, gravada no recebimento. Contá-los lendo o JSON bruto faria a
 * métrica depender do formato que a plataforma manda, e mudá-lo do lado dela
 * quebraria a contagem em silêncio.
 *
 * É também o que faz a **anonimização não mexer em número nenhum**: o
 * `eventType` não é dado pessoal e não é redigido (SPEC-040 §Exclusão). O teste
 * que fecha isso vive no `license-privacy.service.spec`.
 */

/** Uma barra do gráfico de ativações por dia. */
export interface DailyCount {
  /** `YYYY-MM-DD` **no fuso de São Paulo** — é o rótulo que a tela mostra. */
  day: string;
  count: number;
}

export interface LicensingSummary {
  /** A janela pedida, ecoada: a tela nunca supõe qual período está vendo. */
  period: Period;
  /** Ativações por dia na janela, já no fuso de São Paulo. */
  activationsByDay: DailyCount[];
  /** Licenças por status — estado corrente, **não** recorte de período. */
  licensesByStatus: { active: number; revoked: number; expired: number };
  /** Contagem de eventos da plataforma na janela. Nunca valor. */
  sales: { approved: number; refunded: number; chargeback: number };
  /**
   * Assinaturas: quantas vivas e quantas em atraso registrado (`pastDueAt`).
   * Estado corrente — "quantas estão inadimplentes agora", não "quantas
   * ficaram no mês".
   */
  subscriptions: { active: number; pastDue: number };
  /** Máquinas ativas agora (as desativadas saíram da contagem de vagas). */
  activeMachines: number;
  /** Acesso ao repo source, por estado (SPEC-039). */
  sourceAccess: Record<string, number>;
  /**
   * **Zero é resultado; ausência é outra coisa** (§2.7 da SPEC-035).
   *
   * *"Nenhuma venda no período"* e *"nunca vendeu"* são fatos diferentes e
   * renderizam diferente. Por isso este sinal viaja **fora** do recorte de
   * período: ele responde "já houve alguma vez", que nenhuma janela responde.
   * Sem ele a tela mostraria "0 vendas" para quem nunca vendeu, e o operador
   * leria como queda.
   */
  everSold: boolean;
}

/** Os tipos crus da plataforma que cada contador conta. */
const APPROVED = 'order_approved';
const REFUNDED = 'order_refunded';
const CHARGEBACK = 'chargeback';

const MS_POR_HORA = 60 * 60 * 1000;
/** Ver `period.ts`: constante porque o Brasil não tem horário de verão. */
const SAO_PAULO_UTC_OFFSET_HOURS = -3;

@Injectable()
export class LicensingSummaryService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * As contagens do tenant na janela.
   *
   * **`agora` é parâmetro, não `Date.now()` interno**, porque a virada de mês é
   * o caso que dói e um teste que dependesse do relógio da máquina só falharia
   * no dia 31. Quem chama da rota passa `new Date()`.
   */
  async summary(
    tenantId: string,
    period: Period = DEFAULT_PERIOD,
    agora: Date = new Date(),
  ): Promise<LicensingSummary> {
    const desde = periodStart(period, agora);

    const [ativacoes, porStatus, eventos, assinaturas, maquinas, source, jaVendeu] =
      await Promise.all([
        // As ativações da janela, cruas: o agrupamento por dia é feito em JS
        // porque o dia é o de **São Paulo**, e um `GROUP BY date_trunc` do
        // Postgres cortaria em UTC — jogando a venda das 22 h para o dia
        // seguinte.
        this.prisma.activation.findMany({
          where: { tenantId, activatedAt: { gte: desde } },
          select: { activatedAt: true },
        }),
        this.prisma.license.groupBy({
          by: ['status'],
          where: { tenantId },
          _count: { _all: true },
        }),
        this.prisma.licWebhookEvent.groupBy({
          by: ['eventType'],
          where: {
            tenantId,
            receivedAt: { gte: desde },
            eventType: { in: [APPROVED, REFUNDED, CHARGEBACK] },
          },
          _count: { _all: true },
        }),
        // Assinatura viva = licença ativa numa edição SUBSCRIPTION. O
        // `billingModel` mora na edição (MVP4 §4), não na licença.
        this.prisma.license.findMany({
          where: { tenantId, status: 'ACTIVE', edition: { billingModel: 'SUBSCRIPTION' } },
          select: { pastDueAt: true },
        }),
        this.prisma.activation.count({ where: { tenantId, deactivatedAt: null } }),
        this.prisma.license.groupBy({
          by: ['sourceAccess'],
          where: { tenantId },
          _count: { _all: true },
        }),
        // **Fora do recorte de período, de propósito** — é o que distingue
        // "nenhuma venda no período" de "nunca vendeu".
        this.prisma.licWebhookEvent.findFirst({
          where: { tenantId, eventType: APPROVED },
          select: { id: true },
        }),
      ]);

    const porTipo = (tipo: string) =>
      eventos.find((e) => e.eventType === tipo)?._count._all ?? 0;
    const porStatusDe = (status: string) =>
      porStatus.find((s) => s.status === status)?._count._all ?? 0;

    return {
      period,
      activationsByDay: agruparPorDia(ativacoes.map((a) => a.activatedAt)),
      licensesByStatus: {
        active: porStatusDe('ACTIVE'),
        revoked: porStatusDe('REVOKED'),
        expired: porStatusDe('EXPIRED'),
      },
      sales: {
        approved: porTipo(APPROVED),
        refunded: porTipo(REFUNDED),
        chargeback: porTipo(CHARGEBACK),
      },
      subscriptions: {
        active: assinaturas.length,
        pastDue: assinaturas.filter((l) => l.pastDueAt !== null).length,
      },
      activeMachines: maquinas,
      sourceAccess: Object.fromEntries(
        source.map((s) => [s.sourceAccess, s._count._all]),
      ),
      everSold: jaVendeu !== null,
    };
  }
}

/**
 * Agrupa instantes UTC por **dia de São Paulo**.
 *
 * Dia sem ativação **não aparece na lista** — quem desenha o gráfico preenche a
 * lacuna, porque só a tela sabe quantas barras cabem. Devolver zeros aqui
 * obrigaria este service a conhecer a janela inteira em dias, e `current_month`
 * tem tamanho variável.
 */
export function agruparPorDia(instantes: Date[]): DailyCount[] {
  const porDia = new Map<string, number>();
  for (const instante of instantes) {
    const dia = diaEmSaoPaulo(instante);
    porDia.set(dia, (porDia.get(dia) ?? 0) + 1);
  }
  return [...porDia.entries()]
    .map(([day, count]) => ({ day, count }))
    .sort((a, b) => a.day.localeCompare(b.day));
}

/**
 * `YYYY-MM-DD` no relógio de São Paulo.
 *
 * `toISOString().slice(0, 10)` daria o dia em **UTC** — e uma ativação às 22 h
 * apareceria na barra do dia seguinte. O gráfico ficaria plausível e errado,
 * que é o modo de falhar que esta fatia inteira tenta evitar.
 */
function diaEmSaoPaulo(instante: Date): string {
  const local = new Date(instante.getTime() + SAO_PAULO_UTC_OFFSET_HOURS * MS_POR_HORA);
  return local.toISOString().slice(0, 10);
}
