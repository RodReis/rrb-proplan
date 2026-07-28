import { Prisma } from '@prisma/client';
import type { EffortTask } from './effort-estimator';

/**
 * O CÁLCULO (SPEC-033 §2.3-§2.9). Regra pura — sem Prisma, sem HTTP, sem Nest.
 *
 * Este arquivo é o outro lado do ADR-012: a IA decompôs, aqui o **código
 * calcula**. Nenhuma linha depende de um modelo de linguagem, e é por isso que
 * cada número desta saída consegue **mostrar a sua conta**.
 *
 * ## Duas escolhas que atravessam o arquivo inteiro
 *
 * **1. `Decimal`, nunca `number`.** Dinheiro em ponto flutuante acumula erro em
 * frações de centavo — `0.1 + 0.2 !== 0.3` é o exemplo de manual, e numa soma de
 * 30 tarefas × valor/hora × multiplicador × contingência o desvio deixa de ser
 * teórico. O mesmo motivo pelo qual `LlmUsage.costUsd` é `numeric` no banco.
 *
 * **2. Cada cenário carrega as suas parcelas.** `subtotal`, `contingencia` e
 * `total` viajam separados de propósito (§2.5: "linha própria e visível... nunca
 * embutida no valor/hora nem no total sem discriminação"). Devolver só o total
 * obrigaria a tela a redividir para exibir a conta — e uma tela que recalcula é
 * uma segunda implementação da regra, que diverge na primeira correção.
 */

/** Grau de acabamento (§2.3), lido de `BriefingVersion.answers['9'].complexity`. */
export type Complexity = 'baixa' | 'media' | 'alta';

/**
 * Multiplicador sobre as horas, **antes** da contingência (decisão 1 do PI).
 *
 * Declarado como tabela e **copiado para a linha** da `Estimate` no momento do
 * cálculo (coluna `complexity_factor`): rever estes números no futuro não pode
 * mudar a conta de uma proposta já enviada.
 */
export const COMPLEXITY_FACTORS: Record<Complexity, string> = {
  baixa: '0.85',
  media: '1.00',
  alta: '1.30',
};

export const COMPLEXITY_DEFAULT: Complexity = 'media';

/**
 * Lê a complexidade das respostas do briefing, defensivamente.
 *
 * O `jsonb` chega com **chaves string** (a etapa é `9`, mas a serialização a
 * converte), então os dois acessos existem — é o mesmo cuidado do
 * `briefing-read.service.ts`. Valor ausente ou fora dos três cai em `media`
 * (fator 1,00), que é o neutro: sem ele, um briefing antigo travaria a
 * estimativa inteira por um campo que nem sempre existiu.
 */
export function complexityOf(answers: unknown): Complexity {
  if (typeof answers !== 'object' || answers === null) return COMPLEXITY_DEFAULT;
  const registro = answers as Record<string, unknown>;
  const etapa9 = (registro['9'] ?? registro[9]) as Record<string, unknown> | undefined;
  const valor = etapa9?.complexity;
  if (valor === 'baixa' || valor === 'media' || valor === 'alta') return valor;
  return COMPLEXITY_DEFAULT;
}

export interface DirectCost {
  label: string;
  valueBrl: string;
}

export interface ScenarioResult {
  /** Horas somadas da coluna, **antes** do multiplicador. */
  horasBrutas: string;
  /** Horas depois do grau de acabamento (§2.3). */
  horas: string;
  /** `horas × valor/hora`. */
  maoDeObraBrl: string;
  /** Soma dos custos diretos digitados (§2.7). Igual nos três cenários. */
  custosDiretosBrl: string;
  /** `maoDeObra + custosDiretos` — a base da contingência. */
  subtotalBrl: string;
  /** Linha própria e visível (§2.5). Nunca embutida. */
  contingenciaBrl: string;
  totalBrl: string;
}

export interface MvpGroup {
  mvp: string;
  tarefas: number;
  /** Horas do cenário **provável**, já com o multiplicador. */
  horas: string;
  /** `horas × valor/hora`. Sem contingência: ela é do orçamento, não do grupo. */
  custoBrl: string;
}

export interface AiCost {
  /** FATO: soma do ledger. */
  incurredUsd: string;
  /** PROJEÇÃO — leva o rótulo mesmo quando calculada (§2.8). */
  projected: { valueUsd: string; isCalculated: boolean };
  /**
   * Convertidos para BRL **só quando há taxa**. `null` sem taxa informada: o
   * custo aparece em USD, rotulado, e **fora** do total em BRL (§2.6) — o total
   * não finge incluir o que não converteu.
   */
  incurredBrl: string | null;
  projectedBrl: string | null;
}

export interface CalculationInput {
  tarefas: readonly EffortTask[];
  complexity: Complexity;
  hourlyRateBrl: Prisma.Decimal;
  contingencyPercent: Prisma.Decimal;
  directCosts: readonly DirectCost[];
  aiCostIncurredUsd: Prisma.Decimal;
  aiCostProjectedUsd: Prisma.Decimal;
  aiCostProjectedIsCalculated: boolean;
  /** `null` = sem taxa informada (§2.6). */
  exchangeRate: Prisma.Decimal | null;
}

export interface CalculationResult {
  complexityFactor: string;
  scenarios: {
    otimista: ScenarioResult;
    provavel: ScenarioResult;
    pessimista: ScenarioResult;
  };
  mvpBreakdown: MvpGroup[];
  aiCost: AiCost;
}

/** Centavos: 2 casas, meio-para-cima — a arredondamento comercial de sempre. */
const CENTAVOS = 2;
/** Horas com 2 casas: meia hora e quarto de hora aparecem em estimativa real. */
const CASAS_HORAS = 2;

function dec(v: string | number | Prisma.Decimal): Prisma.Decimal {
  return new Prisma.Decimal(v);
}

function brl(v: Prisma.Decimal): string {
  return v.toDecimalPlaces(CENTAVOS, Prisma.Decimal.ROUND_HALF_UP).toFixed(CENTAVOS);
}

function horasStr(v: Prisma.Decimal): string {
  return v.toDecimalPlaces(CASAS_HORAS, Prisma.Decimal.ROUND_HALF_UP).toFixed(CASAS_HORAS);
}

/**
 * Soma direta de uma coluna (§2.4): **nunca** por fator fixo global.
 *
 * Os três cenários saem de somar `horasMin`, `horasProvavel` e `horasMax`
 * separadamente — e não de multiplicar o provável por ±X%. A diferença importa:
 * a faixa de cada tarefa carrega a incerteza **daquela** tarefa, e achatá-la num
 * fator único apagaria a informação que o modelo produziu item a item.
 */
function somarColuna(
  tarefas: readonly EffortTask[],
  coluna: 'horasMin' | 'horasProvavel' | 'horasMax',
): Prisma.Decimal {
  return tarefas.reduce((acc, t) => acc.plus(dec(t[coluna])), dec(0));
}

function calcularCenario(
  tarefas: readonly EffortTask[],
  coluna: 'horasMin' | 'horasProvavel' | 'horasMax',
  fator: Prisma.Decimal,
  hourlyRateBrl: Prisma.Decimal,
  custosDiretos: Prisma.Decimal,
  contingencyPercent: Prisma.Decimal,
): ScenarioResult {
  const horasBrutas = somarColuna(tarefas, coluna);
  // O multiplicador do grau de acabamento incide sobre os TRÊS cenários
  // (§2.4), e **antes** da contingência (§2.3). A ordem é a conta: aplicar
  // depois faria a contingência ser calculada sobre horas que não são as do
  // orçamento.
  const horas = horasBrutas.times(fator);
  const maoDeObra = horas.times(hourlyRateBrl);
  const subtotal = maoDeObra.plus(custosDiretos);
  // Contingência sobre o SUBTOTAL (§2.5) — mão de obra + custos diretos. Sobre
  // só a mão de obra, uma estimativa com custo direto alto ficaria com reserva
  // proporcionalmente menor justamente onde há mais a dar errado.
  const contingencia = subtotal.times(contingencyPercent).dividedBy(100);

  return {
    horasBrutas: horasStr(horasBrutas),
    horas: horasStr(horas),
    maoDeObraBrl: brl(maoDeObra),
    custosDiretosBrl: brl(custosDiretos),
    subtotalBrl: brl(subtotal),
    contingenciaBrl: brl(contingencia),
    totalBrl: brl(subtotal.plus(contingencia)),
  };
}

/**
 * Agrupa as tarefas por MVP com subtotal de horas e custo (§2.9).
 *
 * **Só dado.** Não cria issue, não toca GitHub — a fronteira que o MVP3 §3
 * declara para esta frente, e que o `estimates-boundaries.arch.spec.ts` prova
 * por ausência.
 *
 * Usa o cenário **provável**: é o número que se leva para uma conversa sobre
 * "o que cabe no primeiro corte". Os três cenários existem para o orçamento
 * total, não para cada grupo — repeti-los aqui triplicaria a tabela sem
 * responder nenhuma pergunta a mais.
 */
function agruparPorMvp(
  tarefas: readonly EffortTask[],
  fator: Prisma.Decimal,
  hourlyRateBrl: Prisma.Decimal,
): MvpGroup[] {
  const porGrupo = new Map<string, { tarefas: number; horas: Prisma.Decimal }>();

  for (const t of tarefas) {
    const atual = porGrupo.get(t.mvp) ?? { tarefas: 0, horas: dec(0) };
    porGrupo.set(t.mvp, {
      tarefas: atual.tarefas + 1,
      horas: atual.horas.plus(dec(t.horasProvavel)),
    });
  }

  return [...porGrupo.entries()]
    // Ordem alfabética: `MVP1` antes de `MVP2`. Manter a ordem de chegada faria
    // a tabela mudar de ordem a cada regeneração, sem nada ter mudado.
    .sort(([a], [b]) => a.localeCompare(b, 'pt-BR'))
    .map(([mvp, { tarefas: qtd, horas }]) => {
      const comFator = horas.times(fator);
      return {
        mvp,
        tarefas: qtd,
        horas: horasStr(comFator),
        custoBrl: brl(comFator.times(hourlyRateBrl)),
      };
    });
}

/**
 * O cálculo completo. Determinístico: mesma entrada, mesma saída, sempre.
 *
 * Não valida a entrada — quem garante a forma das tarefas é o `parseEffort`, e
 * duplicar a checagem aqui criaria duas verdades sobre o que é tarefa válida.
 */
export function calcular(input: CalculationInput): CalculationResult {
  const fator = dec(COMPLEXITY_FACTORS[input.complexity]);
  const custosDiretos = input.directCosts.reduce(
    (acc, c) => acc.plus(dec(c.valueBrl)),
    dec(0),
  );

  const cenario = (coluna: 'horasMin' | 'horasProvavel' | 'horasMax') =>
    calcularCenario(
      input.tarefas,
      coluna,
      fator,
      input.hourlyRateBrl,
      custosDiretos,
      input.contingencyPercent,
    );

  return {
    complexityFactor: fator.toFixed(4),
    scenarios: {
      otimista: cenario('horasMin'),
      provavel: cenario('horasProvavel'),
      pessimista: cenario('horasMax'),
    },
    mvpBreakdown: agruparPorMvp(input.tarefas, fator, input.hourlyRateBrl),
    aiCost: {
      incurredUsd: input.aiCostIncurredUsd.toFixed(8),
      projected: {
        valueUsd: input.aiCostProjectedUsd.toFixed(8),
        isCalculated: input.aiCostProjectedIsCalculated,
      },
      // Sem taxa, os dois ficam `null` — e a tela mostra USD rotulado, fora do
      // total (§2.6). Converter com uma taxa inventada seria pior que não
      // converter: o número entraria no total e ninguém saberia que é chute.
      incurredBrl: input.exchangeRate
        ? brl(input.aiCostIncurredUsd.times(input.exchangeRate))
        : null,
      projectedBrl: input.exchangeRate
        ? brl(input.aiCostProjectedUsd.times(input.exchangeRate))
        : null,
    },
  };
}

/** Mínimo de runs concluídos para projetar custo de IA por média (§2.8). */
export const MIN_RUNS_PARA_PROJECAO = 3;

/**
 * Média de custo por `ArtifactRun` concluído — a projeção do §2.8.
 *
 * Abaixo de `MIN_RUNS_PARA_PROJECAO`, devolve `null` e o chamador cai no campo
 * digitado à mão, rotulado *"projeção não calculada — histórico insuficiente"*.
 * O piso existe porque média de 1 ou 2 execuções não é média: é a última
 * execução com cara de estatística — e ela entraria na conta com a mesma
 * aparência de um número medido.
 */
export function projetarCustoDeIa(
  somaUsd: Prisma.Decimal,
  runsConcluidos: number,
): Prisma.Decimal | null {
  if (runsConcluidos < MIN_RUNS_PARA_PROJECAO) return null;
  return somaUsd.dividedBy(runsConcluidos);
}
