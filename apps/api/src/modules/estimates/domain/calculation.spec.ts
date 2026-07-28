import { Prisma } from '@prisma/client';
import {
  COMPLEXITY_FACTORS,
  MIN_RUNS_PARA_PROJECAO,
  calcular,
  complexityOf,
  projetarCustoDeIa,
  type CalculationInput,
} from './calculation';
import type { EffortTask } from './effort-estimator';

function tarefa(over: Partial<EffortTask> = {}): EffortTask {
  return {
    requisito: 'R',
    tarefa: 'T',
    horasMin: 10,
    horasProvavel: 20,
    horasMax: 30,
    mvp: 'MVP1',
    ...over,
  };
}

function entrada(over: Partial<CalculationInput> = {}): CalculationInput {
  return {
    tarefas: [tarefa()],
    complexity: 'media',
    hourlyRateBrl: new Prisma.Decimal('200'),
    contingencyPercent: new Prisma.Decimal('15'),
    directCosts: [],
    aiCostIncurredUsd: new Prisma.Decimal('0'),
    aiCostProjectedUsd: new Prisma.Decimal('0'),
    aiCostProjectedIsCalculated: false,
    exchangeRate: null,
    ...over,
  };
}

describe('cálculo: os 3 cenários por soma direta das colunas (§2.4)', () => {
  it('soma cada coluna separadamente, nunca por fator global', () => {
    // Duas tarefas com faixas de larguras DIFERENTES: 10-20-30 e 5-40-45.
    // Somas: mín 15 · provável 60 · máx 75.
    // Um "provável ±X%" achataria isso — a faixa de cada tarefa carrega a
    // incerteza daquela tarefa, e um fator único apagaria o que o modelo
    // produziu item a item.
    const out = calcular(
      entrada({
        tarefas: [tarefa(), tarefa({ horasMin: 5, horasProvavel: 40, horasMax: 45 })],
      }),
    );
    expect(out.scenarios.otimista.horasBrutas).toBe('15.00');
    expect(out.scenarios.provavel.horasBrutas).toBe('60.00');
    expect(out.scenarios.pessimista.horasBrutas).toBe('75.00');
  });

  it('a conta completa fecha, conferida à mão', () => {
    // 20 h × 1,00 = 20 h · × R$ 200 = R$ 4.000 · +0 diretos = R$ 4.000
    // contingência 15% = R$ 600 · total = R$ 4.600
    const p = calcular(entrada()).scenarios.provavel;
    expect(p).toEqual({
      horasBrutas: '20.00',
      horas: '20.00',
      maoDeObraBrl: '4000.00',
      custosDiretosBrl: '0.00',
      subtotalBrl: '4000.00',
      contingenciaBrl: '600.00',
      totalBrl: '4600.00',
    });
  });

  it('o total é sempre subtotal + contingência, nos três cenários', () => {
    const out = calcular(
      entrada({ complexity: 'alta', directCosts: [{ label: 'Domínio', valueBrl: '90' }] }),
    );
    for (const c of Object.values(out.scenarios)) {
      const soma = new Prisma.Decimal(c.subtotalBrl).plus(c.contingenciaBrl);
      expect(soma.toFixed(2)).toBe(c.totalBrl);
    }
  });
});

describe('cálculo: o grau de acabamento (§2.3)', () => {
  it.each([
    ['baixa', '0.8500', '17.00', '3400.00'],
    ['media', '1.0000', '20.00', '4000.00'],
    ['alta', '1.3000', '26.00', '5200.00'],
  ])('%s → fator %s: 20 h vira %s h e R$ %s de mão de obra', (
    complexity,
    fator,
    horas,
    maoDeObra,
  ) => {
    const out = calcular(entrada({ complexity: complexity as 'baixa' }));
    expect(out.complexityFactor).toBe(fator);
    expect(out.scenarios.provavel.horas).toBe(horas);
    expect(out.scenarios.provavel.maoDeObraBrl).toBe(maoDeObra);
  });

  it('incide sobre os TRÊS cenários, não só no provável', () => {
    const out = calcular(entrada({ complexity: 'alta' }));
    expect(out.scenarios.otimista.horas).toBe('13.00'); // 10 × 1,3
    expect(out.scenarios.provavel.horas).toBe('26.00'); // 20 × 1,3
    expect(out.scenarios.pessimista.horas).toBe('39.00'); // 30 × 1,3
  });

  it('incide ANTES da contingência — a ordem é a conta', () => {
    // alta: 26 h × 200 = 5.200 · 15% = 780 · total 5.980.
    // Se o fator viesse DEPOIS da contingência, a reserva sairia de 20 h (600)
    // e o total seria outro: a contingência estaria calculada sobre horas que
    // não são as do orçamento.
    const p = calcular(entrada({ complexity: 'alta' })).scenarios.provavel;
    expect(p.contingenciaBrl).toBe('780.00');
    expect(p.totalBrl).toBe('5980.00');
  });

  it('o fator sai na saída para virar snapshot na linha', () => {
    // Gravado além do NÍVEL: rever a tabela de multiplicadores não pode mudar a
    // conta de uma proposta já enviada.
    expect(calcular(entrada({ complexity: 'baixa' })).complexityFactor).toBe('0.8500');
  });
});

describe('cálculo: contingência como linha própria (§2.5)', () => {
  it('aparece discriminada, nunca embutida no total', () => {
    const p = calcular(entrada()).scenarios.provavel;
    expect(p.contingenciaBrl).toBe('600.00');
    // Subtotal e contingência viajam separados de propósito: devolver só o
    // total obrigaria a tela a redividir para exibir a conta — uma segunda
    // implementação da regra, que diverge na primeira correção.
    expect(p.subtotalBrl).not.toBe(p.totalBrl);
  });

  it('incide sobre mão de obra + custos diretos', () => {
    // 4.000 + 1.000 = 5.000 · 15% = 750.
    // Só sobre a mão de obra, uma estimativa com custo direto alto teria
    // reserva proporcionalmente menor justo onde há mais a dar errado.
    const p = calcular(
      entrada({ directCosts: [{ label: 'Licenças', valueBrl: '1000' }] }),
    ).scenarios.provavel;
    expect(p.subtotalBrl).toBe('5000.00');
    expect(p.contingenciaBrl).toBe('750.00');
  });

  it('contingência 0% zera a linha sem quebrar o total', () => {
    const p = calcular(
      entrada({ contingencyPercent: new Prisma.Decimal('0') }),
    ).scenarios.provavel;
    expect(p.contingenciaBrl).toBe('0.00');
    expect(p.totalBrl).toBe(p.subtotalBrl);
  });
});

describe('cálculo: custos diretos (§2.7)', () => {
  it('soma os itens digitados e repete o valor nos três cenários', () => {
    const out = calcular(
      entrada({
        directCosts: [
          { label: 'Domínio', valueBrl: '59.90' },
          { label: 'Hospedagem', valueBrl: '240.10' },
        ],
      }),
    );
    for (const c of Object.values(out.scenarios)) {
      // Custo direto não varia com o cenário: comprar o domínio custa o mesmo
      // se o projeto for rápido ou lento.
      expect(c.custosDiretosBrl).toBe('300.00');
    }
  });

  it('lista vazia é zero, não erro', () => {
    expect(calcular(entrada()).scenarios.provavel.custosDiretosBrl).toBe('0.00');
  });
});

describe('cálculo: dinheiro em Decimal, não float', () => {
  it('não acumula erro em frações de centavo', () => {
    // Em `number`, 0.1+0.2 = 0.30000000000000004. Numa soma de 30 tarefas ×
    // valor/hora × multiplicador × contingência, o desvio deixa de ser teórico.
    const out = calcular(
      entrada({
        directCosts: [
          { label: 'a', valueBrl: '0.10' },
          { label: 'b', valueBrl: '0.20' },
        ],
      }),
    );
    expect(out.scenarios.provavel.custosDiretosBrl).toBe('0.30');
  });

  it('arredonda a centavos, meio-para-cima', () => {
    // 1 h × R$ 0,125 = 0,125 → 0,13.
    const out = calcular(
      entrada({
        tarefas: [tarefa({ horasMin: 1, horasProvavel: 1, horasMax: 1 })],
        hourlyRateBrl: new Prisma.Decimal('0.125'),
        contingencyPercent: new Prisma.Decimal('0'),
      }),
    );
    expect(out.scenarios.provavel.maoDeObraBrl).toBe('0.13');
  });

  it('todo valor monetário sai com 2 casas, sempre', () => {
    const p = calcular(entrada()).scenarios.provavel;
    for (const v of [p.maoDeObraBrl, p.subtotalBrl, p.contingenciaBrl, p.totalBrl]) {
      expect(v).toMatch(/^\d+\.\d{2}$/);
    }
  });

  it('aguenta meia hora e quarto de hora', () => {
    const out = calcular(
      entrada({ tarefas: [tarefa({ horasMin: 0.25, horasProvavel: 1.5, horasMax: 2 })] }),
    );
    expect(out.scenarios.otimista.horas).toBe('0.25');
    expect(out.scenarios.provavel.horas).toBe('1.50');
  });
});

describe('cálculo: decomposição em MVPs (§2.9)', () => {
  it('agrupa com subtotal de horas e custo', () => {
    const out = calcular(
      entrada({
        tarefas: [
          tarefa({ mvp: 'MVP1', horasProvavel: 20 }),
          tarefa({ mvp: 'MVP1', horasProvavel: 10 }),
          tarefa({ mvp: 'MVP2', horasProvavel: 40 }),
        ],
      }),
    );
    expect(out.mvpBreakdown).toEqual([
      { mvp: 'MVP1', tarefas: 2, horas: '30.00', custoBrl: '6000.00' },
      { mvp: 'MVP2', tarefas: 1, horas: '40.00', custoBrl: '8000.00' },
    ]);
  });

  it('o subtotal de horas bate com a soma das tarefas do grupo', () => {
    // Critério de aceite literal (§5).
    const tarefas = [
      tarefa({ mvp: 'MVP1', horasProvavel: 7 }),
      tarefa({ mvp: 'MVP1', horasProvavel: 13 }),
      tarefa({ mvp: 'MVP2', horasProvavel: 5 }),
    ];
    const out = calcular(entrada({ tarefas }));
    for (const grupo of out.mvpBreakdown) {
      const esperado = tarefas
        .filter((t) => t.mvp === grupo.mvp)
        .reduce((acc, t) => acc + t.horasProvavel, 0);
      expect(grupo.horas).toBe(esperado.toFixed(2));
    }
  });

  it('aplica o multiplicador de complexidade no grupo também', () => {
    const out = calcular(
      entrada({ complexity: 'alta', tarefas: [tarefa({ horasProvavel: 10 })] }),
    );
    expect(out.mvpBreakdown[0].horas).toBe('13.00');
  });

  it('ordena por nome — a tabela não muda de ordem a cada regeneração', () => {
    const out = calcular(
      entrada({
        tarefas: [tarefa({ mvp: 'MVP3' }), tarefa({ mvp: 'MVP1' }), tarefa({ mvp: 'MVP2' })],
      }),
    );
    expect(out.mvpBreakdown.map((g) => g.mvp)).toEqual(['MVP1', 'MVP2', 'MVP3']);
  });

  it('o custo do grupo NÃO inclui contingência', () => {
    // Contingência é do orçamento, não do grupo: distribuí-la faria a soma dos
    // grupos parecer o total, sem ser.
    const out = calcular(entrada({ tarefas: [tarefa({ horasProvavel: 20 })] }));
    expect(out.mvpBreakdown[0].custoBrl).toBe('4000.00');
    expect(out.scenarios.provavel.totalBrl).toBe('4600.00');
  });
});

describe('cálculo: custo de IA em duas linhas (§2.8)', () => {
  it('consumido e previsto viajam separados', () => {
    const out = calcular(
      entrada({
        aiCostIncurredUsd: new Prisma.Decimal('0.0453'),
        aiCostProjectedUsd: new Prisma.Decimal('0.06'),
        aiCostProjectedIsCalculated: true,
      }),
    );
    expect(out.aiCost.incurredUsd).toBe('0.04530000');
    expect(out.aiCost.projected).toEqual({ valueUsd: '0.06000000', isCalculated: true });
  });

  it('sem taxa de câmbio, NÃO converte — fica fora do total em BRL', () => {
    // §2.6: o total não finge incluir o que não converteu. Converter com taxa
    // inventada seria pior — o número entraria no total e ninguém saberia que é
    // chute.
    const out = calcular(entrada({ aiCostIncurredUsd: new Prisma.Decimal('10') }));
    expect(out.aiCost.incurredBrl).toBeNull();
    expect(out.aiCost.projectedBrl).toBeNull();
  });

  it('com taxa informada, converte as duas linhas', () => {
    const out = calcular(
      entrada({
        aiCostIncurredUsd: new Prisma.Decimal('10'),
        aiCostProjectedUsd: new Prisma.Decimal('2'),
        exchangeRate: new Prisma.Decimal('5.42'),
      }),
    );
    expect(out.aiCost.incurredBrl).toBe('54.20');
    expect(out.aiCost.projectedBrl).toBe('10.84');
  });

  it('o custo de IA nunca entra no total dos cenários', () => {
    // Ele é linha informativa, não item do orçamento do cliente: somá-lo ao
    // total cobraria do cliente o custo de gerar a proposta dele.
    const semIa = calcular(entrada()).scenarios.provavel.totalBrl;
    const comIa = calcular(
      entrada({
        aiCostIncurredUsd: new Prisma.Decimal('999'),
        exchangeRate: new Prisma.Decimal('5.42'),
      }),
    ).scenarios.provavel.totalBrl;
    expect(comIa).toBe(semIa);
  });
});

describe('projetarCustoDeIa: o piso de 3 runs (§2.8)', () => {
  it.each([0, 1, 2])('com %i run(s) concluído(s), não projeta', (runs) => {
    // Média de 1 ou 2 execuções não é média: é a última execução com cara de
    // estatística — e entraria na conta com aparência de número medido.
    expect(projetarCustoDeIa(new Prisma.Decimal('0.30'), runs)).toBeNull();
  });

  it('com 3 runs, projeta pela média', () => {
    const media = projetarCustoDeIa(new Prisma.Decimal('0.30'), MIN_RUNS_PARA_PROJECAO);
    expect(media?.toFixed(2)).toBe('0.10');
  });

  it('projeção calculada continua sendo projeção', () => {
    // O rótulo vale nos dois casos (§2.8): `isCalculated` diz COMO o número
    // veio, não que ele deixou de ser estimativa.
    const out = calcular(entrada({ aiCostProjectedIsCalculated: true }));
    expect(out.aiCost.projected.isCalculated).toBe(true);
    expect(out.aiCost.projected).toHaveProperty('valueUsd');
  });
});

describe('complexityOf: leitura defensiva do briefing', () => {
  it.each(['baixa', 'media', 'alta'])('lê "%s" da etapa 9', (nivel) => {
    expect(complexityOf({ '9': { complexity: nivel } })).toBe(nivel);
  });

  it('lê com a chave numérica também', () => {
    // O `jsonb` chega com chaves string, mas o objeto em memória pode ter
    // número — mesmo cuidado do `briefing-read.service.ts`.
    expect(complexityOf({ 9: { complexity: 'alta' } })).toBe('alta');
  });

  it.each([
    ['null', null],
    ['sem a etapa 9', { '1': {} }],
    ['valor fora dos três', { '9': { complexity: 'média' } }],
    ['campo ausente', { '9': {} }],
    ['string', 'alta'],
  ])('cai em "media" (fator neutro) para %s', (_caso, answers) => {
    // Neutro e não erro: sem o default, um briefing antigo travaria a
    // estimativa inteira por um campo que nem sempre existiu.
    expect(complexityOf(answers)).toBe('media');
  });

  it('o default tem fator 1,00 — não altera a conta', () => {
    expect(COMPLEXITY_FACTORS.media).toBe('1.00');
  });
});

describe('cálculo: bordas', () => {
  it('lista de tarefas vazia devolve zeros, não erro', () => {
    // A rota não deveria chegar aqui (o `parseEffort` exige 1+ tarefa), mas
    // estourar num cálculo puro seria pior que devolver zero honesto.
    const out = calcular(entrada({ tarefas: [] }));
    expect(out.scenarios.provavel.totalBrl).toBe('0.00');
    expect(out.mvpBreakdown).toEqual([]);
  });

  it('é determinístico — mesma entrada, mesma saída', () => {
    // A promessa do §1: cada número mostra a sua conta, e a conta refeita dá o
    // mesmo número.
    expect(JSON.stringify(calcular(entrada()))).toBe(JSON.stringify(calcular(entrada())));
  });
});
