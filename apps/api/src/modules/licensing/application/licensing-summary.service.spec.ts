import type { PrismaService } from '../../../prisma/prisma.service';
import {
  LicensingSummaryService,
  agruparPorDia,
  type LicensingSummary,
} from './licensing-summary.service';

/**
 * As contagens do painel (SPEC-040 §Métricas).
 *
 * **Todo número tem teste que prova a origem** (MVP3 §9) — é critério de
 * reprovação da fatia, não de estilo. Cada `it` daqui nomeia de qual coluna o
 * número sai e o que aconteceria se saísse de outra.
 */

const AGORA = new Date('2026-08-15T15:00:00.000Z'); // 12:00 BRT

interface Dados {
  ativacoes?: Array<{ activatedAt: Date }>;
  statuses?: Array<{ status: string; n: number }>;
  webhooks?: Array<{ eventType: string; n: number }>;
  assinaturas?: Array<{ pastDueAt: Date | null }>;
  maquinasVivas?: number;
  source?: Array<{ sourceAccess: string; n: number }>;
  jaVendeu?: boolean;
}

function montar(dados: Dados = {}) {
  /** O que cada `where` recebeu — é como se prova de qual coluna o número sai. */
  const chamadas: Record<string, unknown> = {};

  const prisma = {
    activation: {
      findMany: jest.fn(async ({ where }: { where: unknown }) => {
        chamadas.ativacoes = where;
        return dados.ativacoes ?? [];
      }),
      count: jest.fn(async ({ where }: { where: unknown }) => {
        chamadas.maquinas = where;
        return dados.maquinasVivas ?? 0;
      }),
    },
    license: {
      groupBy: jest.fn(async ({ by, where }: { by: string[]; where: unknown }) => {
        if (by[0] === 'status') {
          chamadas.status = where;
          return (dados.statuses ?? []).map((s) => ({
            status: s.status,
            _count: { _all: s.n },
          }));
        }
        chamadas.source = where;
        return (dados.source ?? []).map((s) => ({
          sourceAccess: s.sourceAccess,
          _count: { _all: s.n },
        }));
      }),
      findMany: jest.fn(async ({ where }: { where: unknown }) => {
        chamadas.assinaturas = where;
        return dados.assinaturas ?? [];
      }),
    },
    licWebhookEvent: {
      groupBy: jest.fn(async ({ where }: { where: unknown }) => {
        chamadas.webhooks = where;
        return (dados.webhooks ?? []).map((w) => ({
          eventType: w.eventType,
          _count: { _all: w.n },
        }));
      }),
      findFirst: jest.fn(async ({ where }: { where: unknown }) => {
        chamadas.jaVendeu = where;
        return dados.jaVendeu ? { id: 'wh-1' } : null;
      }),
    },
  } as unknown as PrismaService;

  return { service: new LicensingSummaryService(prisma), prisma, chamadas };
}

describe('SPEC-040: métricas — nenhum valor monetário', () => {
  it('a resposta NÃO tem campo de valor, em nível nenhum', async () => {
    // Prova por ausência (mesmo desenho da SPEC-034/035). Preço não é do
    // ProPlan (decisão #4 do MVP4): vive no payload, sem coluna tipada nem
    // moeda normalizada. Um total derivado dali seria plausível e
    // indefensável — o número sem origem que o MVP3 §9 barra.
    const { service } = montar({
      webhooks: [{ eventType: 'order_approved', n: 3 }],
    });

    const s = await service.summary('t-1', '30', AGORA);
    const chaves = JSON.stringify(s).toLowerCase();

    for (const proibida of [
      'amount',
      'price',
      'valor',
      'total',
      'revenue',
      'receita',
      'currency',
      'moeda',
      'cents',
      'brl',
      'ticket',
    ]) {
      expect(chaves).not.toContain(proibida);
    }
  });

  it('a busca de eventos NÃO lê o payload — só a coluna tipada', async () => {
    // Métrica sobre `payload` dependeria do formato que a plataforma manda, e
    // mudá-lo do lado dela quebraria a contagem em silêncio. É também o que faz
    // a anonimização não mexer em número nenhum.
    const { service, prisma } = montar();
    await service.summary('t-1', '30', AGORA);

    const args = (prisma.licWebhookEvent.groupBy as jest.Mock).mock.calls[0][0];
    expect(args.by).toEqual(['eventType']);
    expect(JSON.stringify(args)).not.toContain('payload');
  });
});

describe('SPEC-040: a origem de cada número', () => {
  it('vendas, reembolsos e chargebacks vêm de eventType, e são distintos', async () => {
    // Reembolso e chargeback são fatos diferentes: um é o cliente desistindo,
    // o outro é a operadora estornando. O `LicEvent` grava os dois como
    // `webhook_revoked` — a distinção só sobrevive em `eventType`.
    const { service } = montar({
      webhooks: [
        { eventType: 'order_approved', n: 12 },
        { eventType: 'order_refunded', n: 2 },
        { eventType: 'chargeback', n: 1 },
      ],
    });

    const s = await service.summary('t-1', '30', AGORA);
    expect(s.sales).toEqual({ approved: 12, refunded: 2, chargeback: 1 });
  });

  it('tipo ausente conta ZERO, e zero é resultado', async () => {
    const { service } = montar({ webhooks: [{ eventType: 'order_approved', n: 5 }] });
    const s = await service.summary('t-1', '30', AGORA);
    expect(s.sales).toEqual({ approved: 5, refunded: 0, chargeback: 0 });
  });

  it('licenças por status são estado CORRENTE, sem recorte de período', async () => {
    // Uma licença revogada em janeiro continua revogada em agosto. Filtrar por
    // período aqui faria o painel dizer "0 revogadas" numa janela sem
    // revogação nova — e o operador leria como se ninguém tivesse sido
    // revogado.
    const { service, chamadas } = montar({
      statuses: [
        { status: 'ACTIVE', n: 40 },
        { status: 'REVOKED', n: 3 },
        { status: 'EXPIRED', n: 7 },
      ],
    });

    const s = await service.summary('t-1', '7', AGORA);
    expect(s.licensesByStatus).toEqual({ active: 40, revoked: 3, expired: 7 });
    expect(JSON.stringify(chamadas.status)).not.toContain('gte');
  });

  it('assinaturas: ativas e inadimplentes saem de pastDueAt', async () => {
    // `pastDueAt` registra atraso SEM mudar `status` (SPEC-038): cartão
    // recusado é rotina e a plataforma retenta. Contar inadimplente pelo
    // `status` daria zero sempre.
    const { service } = montar({
      assinaturas: [
        { pastDueAt: null },
        { pastDueAt: null },
        { pastDueAt: new Date('2026-08-10T00:00:00Z') },
      ],
    });

    const s = await service.summary('t-1', '30', AGORA);
    expect(s.subscriptions).toEqual({ active: 3, pastDue: 1 });
  });

  it('assinatura é filtrada pela EDIÇÃO, não pela licença', async () => {
    // `billingModel` mora na edição (MVP4 §4). Sem este filtro, licença
    // perpétua entraria na contagem de assinaturas e o número diria que há
    // mais recorrência do que existe.
    const { service, chamadas } = montar();
    await service.summary('t-1', '30', AGORA);

    expect(chamadas.assinaturas).toMatchObject({
      status: 'ACTIVE',
      edition: { billingModel: 'SUBSCRIPTION' },
    });
  });

  it('máquinas ativas exclui as desativadas', async () => {
    // Desativada saiu da contagem de vagas (SPEC-037) sem sair da trilha.
    // Contá-la aqui inflaria o número que responde "quantas máquinas há em uso".
    const { service, chamadas } = montar({ maquinasVivas: 17 });
    const s = await service.summary('t-1', '30', AGORA);

    expect(s.activeMachines).toBe(17);
    expect(chamadas.maquinas).toMatchObject({ deactivatedAt: null });
  });

  it('acesso source é contado por estado', async () => {
    const { service } = montar({
      source: [
        { sourceAccess: 'ACTIVE', n: 4 },
        { sourceAccess: 'PENDING', n: 2 },
        { sourceAccess: 'FAILED', n: 1 },
      ],
    });

    const s = await service.summary('t-1', '30', AGORA);
    expect(s.sourceAccess).toEqual({ ACTIVE: 4, PENDING: 2, FAILED: 1 });
  });

  it('as ativações da janela são filtradas pelo início do período', async () => {
    const { service, chamadas } = montar();
    await service.summary('t-1', '7', AGORA);

    expect(chamadas.ativacoes).toMatchObject({
      tenantId: 't-1',
      activatedAt: { gte: new Date('2026-08-08T15:00:00.000Z') },
    });
  });

  it('todo bloco é filtrado por tenant', async () => {
    // O RLS é do banco, mas o filtro explícito é a segunda barreira — e sem ele
    // um bloco novo escrito sem cuidado somaria o tenant inteiro do vizinho.
    const { service, chamadas } = montar();
    await service.summary('t-1', '30', AGORA);

    for (const chamada of Object.values(chamadas)) {
      expect(chamada).toMatchObject({ tenantId: 't-1' });
    }
  });
});

describe('SPEC-040: zero é resultado, ausência é outra coisa', () => {
  it('"nunca vendeu" viaja FORA do recorte de período', async () => {
    // Sem este sinal, quem nunca vendeu veria "0 vendas" — e leria como queda.
    // Os dois fatos são diferentes e renderizam diferente (§2.7 da SPEC-035).
    const { service, chamadas } = montar({ jaVendeu: true, webhooks: [] });

    const s = await service.summary('t-1', '7', AGORA);
    expect(s.everSold).toBe(true);
    expect(s.sales.approved).toBe(0);
    // A consulta do sinal não tem janela: é "existe alguma vez", não "no
    // período". Filtrá-la por data a tornaria uma cópia do contador.
    expect(JSON.stringify(chamadas.jaVendeu)).not.toContain('gte');
  });

  it('quem nunca vendeu tem everSold falso E contagem zero', async () => {
    const { service } = montar({ jaVendeu: false });
    const s = await service.summary('t-1', '30', AGORA);

    expect(s.everSold).toBe(false);
    expect(s.sales).toEqual({ approved: 0, refunded: 0, chargeback: 0 });
  });

  it('ecoa o período pedido — a tela nunca supõe o que está vendo', async () => {
    const { service } = montar();
    expect((await service.summary('t-1', '90', AGORA)).period).toBe('90');
    expect((await service.summary('t-1', 'current_month', AGORA)).period).toBe(
      'current_month',
    );
  });

  it('sem período, usa o padrão de 30 dias', async () => {
    const { service, chamadas } = montar();
    const s: LicensingSummary = await service.summary('t-1', undefined, AGORA);

    expect(s.period).toBe('30');
    expect(chamadas.ativacoes).toMatchObject({
      activatedAt: { gte: new Date('2026-07-16T15:00:00.000Z') },
    });
  });
});

describe('SPEC-040: ativações por dia viram no fuso de São Paulo', () => {
  it('22 h BRT conta no dia de São Paulo, não no dia UTC seguinte', () => {
    // 2026-08-15 22:00 BRT = 2026-08-16 01:00 UTC. `toISOString().slice(0,10)`
    // diria "16" — e a barra do gráfico apareceria no dia errado, plausível.
    expect(agruparPorDia([new Date('2026-08-16T01:00:00.000Z')])).toEqual([
      { day: '2026-08-15', count: 1 },
    ]);
  });

  it('agrupa e ordena por dia', () => {
    const contagem = agruparPorDia([
      new Date('2026-08-15T15:00:00.000Z'),
      new Date('2026-08-15T18:00:00.000Z'),
      new Date('2026-08-14T15:00:00.000Z'),
    ]);

    expect(contagem).toEqual([
      { day: '2026-08-14', count: 1 },
      { day: '2026-08-15', count: 2 },
    ]);
  });

  it('dia sem ativação NÃO aparece — quem preenche a lacuna é a tela', () => {
    // Devolver zeros aqui obrigaria o service a conhecer a janela inteira em
    // dias, e `current_month` tem tamanho variável. Só a tela sabe quantas
    // barras cabem.
    const contagem = agruparPorDia([
      new Date('2026-08-10T15:00:00.000Z'),
      new Date('2026-08-15T15:00:00.000Z'),
    ]);

    expect(contagem.map((c) => c.day)).toEqual(['2026-08-10', '2026-08-15']);
  });

  it('lista vazia devolve lista vazia, não erro', () => {
    expect(agruparPorDia([])).toEqual([]);
  });
});
