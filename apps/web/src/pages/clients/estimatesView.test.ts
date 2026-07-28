import { describe, expect, it } from 'vitest';
import type { EffortBreakdownView, EstimateDetail, ScenarioView } from '../../lib/api';
import {
  aiCostLines,
  brl,
  complexityLabel,
  effortBlockedReason,
  gapsOf,
  headlineTotal,
  horas,
  isApproved,
  scenarioLines,
  tasksOf,
} from './estimatesView';

const CENARIO: ScenarioView = {
  horasBrutas: '20.00',
  horas: '20.00',
  maoDeObraBrl: '4000.00',
  custosDiretosBrl: '0.00',
  subtotalBrl: '4000.00',
  contingenciaBrl: '600.00',
  totalBrl: '4600.00',
};

function estimativa(over: Partial<EstimateDetail> = {}): EstimateDetail {
  return {
    id: 'e-1',
    version: 1,
    clientProjectId: 'cp-1',
    effortVersionId: 'av-1',
    hourlyRateBrl: '200',
    contingencyPercent: '15',
    complexity: 'media',
    complexityFactor: '1.0000',
    exchangeRate: null,
    exchangeRateAt: null,
    directCosts: [],
    aiCostIncurredUsd: '0.04530000',
    aiCostProjected: { valueUsd: '0.06000000', isCalculated: false },
    scenarios: { otimista: CENARIO, provavel: CENARIO, pessimista: CENARIO },
    mvpBreakdown: [],
    approvedAt: null,
    approvedBy: null,
    createdAt: '2026-07-28T12:00:00.000Z',
    createdBy: 'u-1',
    ...over,
  };
}

describe('formatação: nunca faz aritmética, só apresenta', () => {
  it('formata BRL a partir da string do servidor', () => {
    expect(brl('4600.00')).toContain('4.600,00');
  });

  it('valor ilegível volta como veio, sem virar NaN na tela', () => {
    expect(brl('abc')).toBe('abc');
  });

  it('formata horas sem casas decimais inúteis', () => {
    expect(horas('20.00')).toBe('20 h');
    expect(horas('1.50')).toBe('1,5 h');
  });

  it.each([
    ['baixa', 'Baixa'],
    ['media', 'Média'],
    ['alta', 'Alta'],
  ])('traduz a complexidade %s → %s', (valor, esperado) => {
    // O dado é `media` SEM acento (contrato do briefing). Exibi-lo cru já
    // produziu defeito nesta frente — a etapa 9 mostrava `alta` no dogfooding
    // da SPEC-031.
    expect(complexityLabel(valor)).toBe(esperado);
  });

  it('valor desconhecido de complexidade aparece cru, não some', () => {
    expect(complexityLabel('altíssima')).toBe('altíssima');
  });
});

describe('scenarioLines: a contingência é linha própria (§2.5)', () => {
  it('mostra as parcelas na ordem em que a conta acontece', () => {
    expect(scenarioLines(CENARIO).map((l) => l.label)).toEqual([
      'Horas',
      'Mão de obra',
      'Custos diretos',
      'Subtotal',
      'Contingência',
      'Total',
    ]);
  });

  it('a contingência aparece separada do total', () => {
    // Somá-la ao total "para simplificar" desfaz exatamente o que a spec exige.
    const linhas = scenarioLines(CENARIO);
    const cont = linhas.find((l) => l.label === 'Contingência');
    const total = linhas.find((l) => l.label === 'Total');
    expect(cont?.value).toContain('600,00');
    expect(total?.value).toContain('4.600,00');
  });

  it('não recalcula nada — usa os valores que o servidor mandou', () => {
    // Uma tela que refaz a conta é uma segunda implementação da regra, e ela
    // diverge na primeira correção.
    const mentiroso: ScenarioView = { ...CENARIO, totalBrl: '9999.99' };
    const total = scenarioLines(mentiroso).find((l) => l.label === 'Total');
    expect(total?.value).toContain('9.999,99');
  });
});

describe('aiCostLines: USD fora do total quando não há câmbio (§2.6)', () => {
  it('sem taxa, mostra só USD e AVISA que está fora do total', () => {
    const out = aiCostLines(estimativa());
    expect(out.incurred).toBe('US$ 0.0453');
    expect(out.outsideTotal).toMatch(/NÃO entra no total em BRL/);
  });

  it('com taxa, mostra USD e o convertido', () => {
    const out = aiCostLines(estimativa({ exchangeRate: '5.42' }));
    expect(out.incurred).toContain('US$ 0.0453');
    expect(out.incurred).toContain('0,25');
    expect(out.outsideTotal).toBeNull();
  });

  it('projeção NÃO calculada leva o rótulo de histórico insuficiente', () => {
    expect(aiCostLines(estimativa()).projectedNote).toMatch(/histórico insuficiente/);
  });

  it('projeção CALCULADA continua rotulada como projeção', () => {
    // `isCalculated` diz COMO o número veio, não que ele deixou de ser
    // estimativa — mostrá-lo com a confiança de um número medido é o erro que o
    // rótulo existe para impedir.
    const out = aiCostLines(
      estimativa({ aiCostProjected: { valueUsd: '0.10000000', isCalculated: true } }),
    );
    expect(out.projectedNote).toMatch(/^projeção/);
    expect(out.projectedNote).toMatch(/média das execuções/);
  });
});

describe('effortBlockedReason: por que o botão não aparece', () => {
  function view(over: Partial<EffortBreakdownView> = {}): EffortBreakdownView {
    return {
      canGenerate: false,
      state: 'BRIEFING_SUBMITTED',
      artifact: { kind: 'effort_breakdown', state: null, versions: [] },
      run: null,
      ...over,
    };
  }

  it('com o card em ARTIFACTS_READY, não há motivo — o botão aparece', () => {
    expect(effortBlockedReason(view({ canGenerate: true, state: 'ARTIFACTS_READY' }))).toBeNull();
  });

  it('antes dos 4 aprovados, explica o que falta', () => {
    // Sem isso a pessoa vê um painel vazio e nenhuma explicação.
    expect(effortBlockedReason(view())).toMatch(/4 artefatos precisam estar aprovados/);
  });

  it.each(['CONTRACT_PENDING', 'IN_PRODUCTION', 'DELIVERED'])(
    'com o card em %s, diz que o projeto já avançou',
    (state) => {
      expect(effortBlockedReason(view({ state }))).toMatch(/já avançou no funil/);
    },
  );
});

describe('tasksOf e gapsOf: leitura do jsonb editável à mão', () => {
  it('lê as tarefas de um conteúdo bem formado', () => {
    const out = tasksOf({
      tarefas: [
        { requisito: 'R', tarefa: 'T', horasMin: 1, horasProvavel: 2, horasMax: 3, mvp: 'MVP1' },
      ],
    });
    expect(out).toHaveLength(1);
    expect(out[0].tarefa).toBe('T');
  });

  it.each([
    ['null', null],
    ['string', 'x'],
    ['sem o campo', { outra: [] }],
    ['campo que não é lista', { tarefas: 'x' }],
  ])('devolve lista vazia para conteúdo inválido: %s', (_caso, content) => {
    // A versão corrente pode ser `human` — edição à mão não passa por schema.
    expect(tasksOf(content)).toEqual([]);
  });

  it('descarta item sem o campo tarefa', () => {
    expect(tasksOf({ tarefas: [{ requisito: 'R' }, null, 'x'] })).toEqual([]);
  });

  it('lê os requisitos sem tarefa, para MOSTRAR (nunca para bloquear)', () => {
    // Mesmo desenho do revisor: anota, não bloqueia. Transformar a anotação em
    // bloqueio daria à IA um veto por via indireta.
    expect(gapsOf({ requisitosSemTarefa: ['Painel do cliente'] })).toEqual([
      'Painel do cliente',
    ]);
  });

  it('sem lacunas, devolve vazio', () => {
    expect(gapsOf({ tarefas: [] })).toEqual([]);
  });
});

describe('estado da estimativa', () => {
  it('não aprovada tem approvedAt nulo', () => {
    expect(isApproved(estimativa())).toBe(false);
  });

  it('aprovada é reconhecida', () => {
    expect(isApproved(estimativa({ approvedAt: '2026-07-28T13:00:00.000Z' }))).toBe(true);
  });

  it('o total de destaque é o do cenário provável', () => {
    expect(headlineTotal(estimativa())).toContain('4.600,00');
  });
});
