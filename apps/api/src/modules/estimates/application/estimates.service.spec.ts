import { Prisma } from '@prisma/client';
import type { PrismaService } from '../../../prisma/prisma.service';
import type { ClientsService } from '../../clients/application/clients.service';
import { EstimatesService } from './estimates.service';

const EFFORT_CONTENT = {
  tarefas: [
    { requisito: 'R1', tarefa: 'T1', horasMin: 10, horasProvavel: 20, horasMax: 30, mvp: 'MVP1' },
  ],
};

interface Cenario {
  state?: string;
  effortState?: string | null;
  effortContent?: unknown;
  complexity?: string;
  /** Linhas do ledger somadas por run. */
  custoLedger?: string | null;
  /** Quantos `ArtifactRun` COMPLETED o tenant tem (piso de 3 para projetar). */
  runsConcluidos?: number;
  settings?: Partial<{
    hourlyRateBrl: string;
    contingencyPercent: string;
    exchangeRateUsdBrl: string | null;
  }>;
  estimateExistente?: { approvedAt: Date | null; version: number } | null;
  transicaoFalha?: boolean;
}

function montar({
  state = 'ARTIFACTS_READY',
  effortState = 'APPROVED',
  effortContent = EFFORT_CONTENT,
  complexity = 'media',
  custoLedger = '0.0453',
  runsConcluidos = 0,
  settings = {},
  estimateExistente = null,
  transicaoFalha = false,
}: Cenario = {}) {
  const gravadas: Array<Record<string, unknown>> = [];

  const prisma = {
    clientProject: {
      findFirst: jest.fn(async () => ({
        id: 'cp-1',
        state,
        briefingVersions: [{ answers: { '9': { complexity } } }],
      })),
    },
    artifact: {
      findFirst: jest.fn(async () =>
        effortState
          ? { id: 'art-eff', state: effortState, currentVersionId: 'av-eff' }
          : null,
      ),
    },
    artifactVersion: {
      findFirst: jest.fn(async () => ({ id: 'av-eff', content: effortContent })),
    },
    artifactRun: {
      findMany: jest.fn(async ({ where }: { where: Record<string, unknown> }) =>
        where.status === 'COMPLETED'
          ? Array.from({ length: runsConcluidos }, (_, i) => ({ id: `run-${i}` }))
          : [{ id: 'run-1' }],
      ),
    },
    llmUsage: {
      aggregate: jest.fn(async () => ({
        _sum: { costUsd: custoLedger === null ? null : new Prisma.Decimal(custoLedger) },
      })),
    },
    tenantSettings: {
      upsert: jest.fn(async () => ({
        hourlyRateBrl: new Prisma.Decimal(settings.hourlyRateBrl ?? '200'),
        contingencyPercent: new Prisma.Decimal(settings.contingencyPercent ?? '15'),
        exchangeRateUsdBrl:
          settings.exchangeRateUsdBrl === undefined || settings.exchangeRateUsdBrl === null
            ? null
            : new Prisma.Decimal(settings.exchangeRateUsdBrl),
        exchangeRateAt: settings.exchangeRateUsdBrl ? new Date('2026-07-28') : null,
      })),
    },
    estimate: {
      findFirst: jest.fn(async () =>
        estimateExistente
          ? {
              id: 'est-1',
              clientProjectId: 'cp-1',
              approvedAt: estimateExistente.approvedAt,
              version: estimateExistente.version,
              hourlyRateBrl: new Prisma.Decimal('200'),
              contingencyPercent: new Prisma.Decimal('15'),
              complexityFactor: new Prisma.Decimal('1'),
              exchangeRate: null,
              aiCostIncurredUsd: new Prisma.Decimal('0'),
              scenarios: {},
            }
          : null,
      ),
      findMany: jest.fn(async () => []),
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        gravadas.push(data);
        return { id: 'est-nova', version: data.version };
      }),
      update: jest.fn(async () => ({})),
    },
  } as unknown as PrismaService;

  const clients = {
    transition: jest.fn(async () => {
      if (transicaoFalha) throw new Error('transição inválida');
      return {};
    }),
  } as unknown as ClientsService;

  const service = new EstimatesService(prisma, clients);
  return { service, prisma, clients, gravadas };
}

/** O `byId` do retorno do generate lê o mock de `findFirst`, que devolve null. */
async function gerar(service: EstimatesService, input = {}) {
  await service.generate('t-1', 'cp-1', 'u-1', input).catch(() => undefined);
}

/** Coluna gravada, como texto — `Decimal` e string caem no mesmo formato. */
function texto(linha: Record<string, unknown>, coluna: string): string {
  return String(linha[coluna]);
}

describe('EstimatesService: o gate do cálculo (§5)', () => {
  it.each([
    ['rejeitada', 'REJECTED'],
    ['em revisão', 'PENDING_REVIEW'],
    ['inexistente', null],
  ])('recusa calcular com a decomposição %s', async (_caso, effortState) => {
    // Calcular sobre decomposição não revisada produziria um preço com a mesma
    // aparência de um conferido.
    const { service } = montar({ effortState });
    await expect(service.generate('t-1', 'cp-1', 'u-1')).rejects.toThrow(
      /decomposição de esforço precisa estar aprovada/,
    );
  });

  it('recusa quando a decomposição aprovada não tem tarefa utilizável', async () => {
    const { service } = montar({ effortContent: { tarefas: [] } });
    await expect(service.generate('t-1', 'cp-1', 'u-1')).rejects.toThrow(
      /nenhuma tarefa utilizável/,
    );
  });

  it('calcula sobre a versão CORRENTE, mesmo editada à mão', async () => {
    // Se um humano editou as horas, é a edição que vale — calcular sobre a
    // versão da IA descartaria a correção sem avisar, e o preço sairia
    // diferente do que a pessoa viu ao aprovar.
    const { service, prisma } = montar();
    await gerar(service);
    expect(prisma.artifactVersion.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ id: 'av-eff' }) }),
    );
  });
});

describe('EstimatesService: o que fica gravado', () => {
  it('grava os parâmetros como SNAPSHOT, não referência', async () => {
    // Sem o snapshot, editar o valor/hora do tenant recalcularia em silêncio
    // uma proposta já enviada ao cliente.
    const { service, gravadas } = montar({ settings: { hourlyRateBrl: '250' } });
    await gerar(service);
    expect(texto(gravadas[0], 'hourlyRateBrl')).toBe('250');
    expect(texto(gravadas[0], 'contingencyPercent')).toBe('15');
  });

  it('grava o FATOR além do nível de complexidade', async () => {
    // Rever a tabela de multiplicadores não pode mudar conta já feita.
    const { service, gravadas } = montar({ complexity: 'alta' });
    await gerar(service);
    expect(gravadas[0].complexity).toBe('alta');
    expect(texto(gravadas[0], 'complexityFactor')).toBe('1.3');
  });

  it('grava os 3 cenários com a contingência discriminada', async () => {
    const { service, gravadas } = montar();
    await gerar(service);
    const cenarios = gravadas[0].scenarios as Record<string, Record<string, string>>;
    // 20 h × 200 = 4.000 · 15% = 600 · total 4.600.
    expect(cenarios.provavel.subtotalBrl).toBe('4000.00');
    expect(cenarios.provavel.contingenciaBrl).toBe('600.00');
    expect(cenarios.provavel.totalBrl).toBe('4600.00');
  });

  it('grava o agrupamento por MVP', async () => {
    const { service, gravadas } = montar();
    await gerar(service);
    expect(gravadas[0].mvpBreakdown).toEqual([
      { mvp: 'MVP1', tarefas: 1, horas: '20.00', custoBrl: '4000.00' },
    ]);
  });

  it('grava o ator que calculou', async () => {
    const { service, gravadas } = montar();
    await gerar(service);
    expect(gravadas[0].createdBy).toBe('u-1');
  });

  it('reestimar cria versão nova, nunca sobrescreve (§2.10)', async () => {
    const { service, prisma, gravadas } = montar();
    (prisma.estimate.findFirst as jest.Mock).mockResolvedValueOnce({ version: 2 });
    await gerar(service);
    expect(gravadas[0].version).toBe(3);
    expect(prisma.estimate.update).not.toHaveBeenCalled();
  });
});

describe('EstimatesService: custo de IA (§2.8, ADR-016)', () => {
  it('consumido vem do LEDGER, nunca de ArtifactVersion', async () => {
    const { service, prisma, gravadas } = montar({ custoLedger: '0.0453' });
    await gerar(service);
    expect(prisma.llmUsage.aggregate).toHaveBeenCalled();
    expect(texto(gravadas[0], 'aiCostIncurredUsd')).toBe('0.0453');
  });

  it('ledger vazio vira zero, não erro', async () => {
    // "Nenhuma chamada" e "chamada sem preço cadastrado" custaram ambas R$ 0,00
    // de fato conhecido. O que não se faz é inventar valor para a segunda.
    const { service, gravadas } = montar({ custoLedger: null });
    await gerar(service);
    expect(texto(gravadas[0], 'aiCostIncurredUsd')).toBe('0');
  });

  it.each([0, 1, 2])(
    'com %i run(s) concluído(s), a projeção NÃO é calculada',
    async (runs) => {
      const { service, gravadas } = montar({ runsConcluidos: runs });
      await gerar(service, { aiCostProjectedUsd: '0.99' });
      const projetado = gravadas[0].aiCostProjected as Record<string, unknown>;
      expect(projetado.isCalculated).toBe(false);
      expect(projetado.valueUsd).toBe('0.99000000');
    },
  );

  it('com 3+ runs concluídos, calcula pela média e ignora o digitado', async () => {
    // Aceitar os dois deixaria o número exibido dependendo de qual caminho o
    // código tomou.
    const { service, gravadas } = montar({ runsConcluidos: 3, custoLedger: '0.30' });
    await gerar(service, { aiCostProjectedUsd: '99' });
    const projetado = gravadas[0].aiCostProjected as Record<string, unknown>;
    expect(projetado.isCalculated).toBe(true);
    expect(projetado.valueUsd).toBe('0.10000000');
  });

  it('projeção calculada continua rotulada como projeção', async () => {
    const { service, gravadas } = montar({ runsConcluidos: 5 });
    await gerar(service);
    expect(gravadas[0].aiCostProjected).toHaveProperty('isCalculated');
  });
});

describe('EstimatesService: câmbio (§2.6)', () => {
  it('sem taxa informada, grava exchangeRate nulo', async () => {
    const { service, gravadas } = montar();
    await gerar(service);
    expect(gravadas[0].exchangeRate).toBeNull();
    expect(gravadas[0].exchangeRateAt).toBeNull();
  });

  it('com taxa, grava o par completo', async () => {
    const { service, gravadas } = montar({ settings: { exchangeRateUsdBrl: '5.42' } });
    await gerar(service);
    expect(texto(gravadas[0], 'exchangeRate')).toBe('5.42');
    expect(gravadas[0].exchangeRateAt).toBeInstanceOf(Date);
  });
});

describe('EstimatesService: aprovar move o card (§2.11)', () => {
  it('move ARTIFACTS_READY → CONTRACT_PENDING com ator não nulo', async () => {
    const { service, clients } = montar({
      estimateExistente: { approvedAt: null, version: 1 },
    });
    const out = await service.approve('t-1', 'est-1', 'u-1');
    expect(out).toEqual({ approved: true, cardMoved: true, alreadyApproved: false });
    expect(clients.transition).toHaveBeenCalledWith(
      't-1',
      'cp-1',
      { to: 'CONTRACT_PENDING' },
      'u-1',
    );
  });

  it('grava quem aprovou e quando', async () => {
    const { service, prisma } = montar({
      estimateExistente: { approvedAt: null, version: 1 },
    });
    await service.approve('t-1', 'est-1', 'u-1');
    expect(prisma.estimate.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ approvedBy: 'u-1', approvedAt: expect.any(Date) }),
      }),
    );
  });

  it('transição recusada NÃO desfaz a aprovação', async () => {
    // A aprovação já está gravada e é o ato que a pessoa pediu — mesmo desenho
    // do `ArtifactReviewService`.
    const { service, prisma } = montar({
      estimateExistente: { approvedAt: null, version: 1 },
      transicaoFalha: true,
    });
    const out = await service.approve('t-1', 'est-1', 'u-1');
    expect(out.approved).toBe(true);
    expect(out.cardMoved).toBe(false);
    expect(prisma.estimate.update).toHaveBeenCalled();
  });

  it('aprovar duas vezes é idempotente e não move de novo', async () => {
    const { service, clients } = montar({
      estimateExistente: { approvedAt: new Date('2026-07-28'), version: 1 },
    });
    const out = await service.approve('t-1', 'est-1', 'u-1');
    expect(out).toEqual({ approved: true, cardMoved: false, alreadyApproved: true });
    expect(clients.transition).not.toHaveBeenCalled();
  });

  it('estimativa de outro tenant devolve não-encontrado', async () => {
    const { service } = montar({ estimateExistente: null });
    await expect(service.approve('t-1', 'est-outro', 'u-1')).rejects.toThrow(
      'Estimativa não encontrada',
    );
  });
});

describe('EstimatesService: reestimar não move o card de volta (§2.12)', () => {
  it('gerar versão nova nunca chama transition', async () => {
    // A nova versão fica disponível para quem monta o contrato decidir qual
    // usar; o funil segue de onde estava.
    const { service, clients } = montar({ state: 'CONTRACT_PENDING' });
    await gerar(service);
    expect(clients.transition).not.toHaveBeenCalled();
  });
});

describe('EstimatesService: leitura defensiva do jsonb editado à mão', () => {
  it('descarta tarefa com horas inválidas em vez de adivinhar', async () => {
    // Adivinhar o que um campo malformado queria dizer produziria horas
    // inventadas dentro de um cálculo que existe para não ter nenhuma.
    const { service, gravadas } = montar({
      effortContent: {
        tarefas: [
          { requisito: 'R', tarefa: 'boa', horasMin: 1, horasProvavel: 2, horasMax: 3, mvp: 'MVP1' },
          { requisito: 'R', tarefa: 'ruim', horasMin: 'x', horasProvavel: null, horasMax: 3 },
        ],
      },
    });
    await gerar(service);
    const cenarios = gravadas[0].scenarios as Record<string, Record<string, string>>;
    expect(cenarios.provavel.horasBrutas).toBe('2.00');
  });

  it('tarefa sem MVP cai num balde nomeado, não some do orçamento', async () => {
    const { service, gravadas } = montar({
      effortContent: {
        tarefas: [{ requisito: 'R', tarefa: 't', horasMin: 1, horasProvavel: 2, horasMax: 3 }],
      },
    });
    await gerar(service);
    expect(gravadas[0].mvpBreakdown).toEqual([
      expect.objectContaining({ mvp: 'sem MVP', tarefas: 1 }),
    ]);
  });

  it('complexidade ausente no briefing cai no neutro (1,00)', async () => {
    const { service, prisma, gravadas } = montar();
    (prisma.clientProject.findFirst as jest.Mock).mockResolvedValueOnce({
      id: 'cp-1',
      state: 'ARTIFACTS_READY',
      briefingVersions: [],
    });
    await gerar(service);
    expect(gravadas[0].complexity).toBe('media');
    expect(texto(gravadas[0], 'complexityFactor')).toBe('1');
  });
});
