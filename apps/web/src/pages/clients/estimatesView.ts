import type {
  EffortBreakdownView,
  EffortTaskView,
  EstimateDetail,
  ScenarioView,
} from '../../lib/api';

/**
 * Regras de leitura da estimativa (SPEC-033), **fora do React**.
 *
 * Ficam aqui pela mesma razão do `artifactsView.ts`: é o que erra sem aparecer
 * em revisão visual — um rótulo trocado, um `null` exibido como zero, uma
 * projeção com cara de número medido. Cinco ocorrências dessa classe nesta
 * frente, e nenhuma delas quebra a tela: todas produzem uma tela **plausível e
 * errada**.
 *
 * A regra que atravessa o arquivo: **nada aqui recalcula**. O servidor mandou
 * `subtotal`, `contingencia` e `total` prontos justamente para que a tela não
 * precise dividir nada — uma tela que refaz a conta é uma segunda
 * implementação da regra, e ela diverge na primeira correção.
 */

/** Formata BRL a partir da string do servidor. Nunca faz aritmética. */
export function brl(valor: string): string {
  const n = Number(valor);
  if (!Number.isFinite(n)) return valor;
  return n.toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    minimumFractionDigits: 2,
  });
}

/** Horas com no máximo 2 casas — `20.00` vira `20 h`, `1.50` vira `1,5 h`. */
export function horas(valor: string): string {
  const n = Number(valor);
  if (!Number.isFinite(n)) return `${valor} h`;
  return `${n.toLocaleString('pt-BR', { maximumFractionDigits: 2 })} h`;
}

const COMPLEXITY_LABELS: Record<string, string> = {
  baixa: 'Baixa',
  media: 'Média',
  alta: 'Alta',
};

/**
 * Rótulo do grau de acabamento.
 *
 * Existe porque o dado é `'media'` **sem acento** (contrato do briefing) e
 * exibi-lo cru já produziu defeito nesta frente: a etapa 9 mostrava `alta` em
 * vez de "Alta" no dogfooding da SPEC-031.
 */
export function complexityLabel(complexity: string): string {
  return COMPLEXITY_LABELS[complexity] ?? complexity;
}

/** Rótulos dos 3 cenários, na ordem de exibição. */
export const SCENARIOS = [
  { key: 'otimista', label: 'Otimista' },
  { key: 'provavel', label: 'Provável' },
  { key: 'pessimista', label: 'Pessimista' },
] as const;

export type ScenarioKey = (typeof SCENARIOS)[number]['key'];

/**
 * As linhas da conta de um cenário, **na ordem em que a conta acontece**.
 *
 * Devolvidas como lista para que a tela renderize sem escolher o que mostrar: a
 * contingência é linha própria por decisão do §2.5, e uma tela que a some ao
 * total "para simplificar" desfaz exatamente o que a spec exige.
 */
export function scenarioLines(
  cenario: ScenarioView,
): Array<{ label: string; value: string; emphasis?: boolean }> {
  return [
    { label: 'Horas', value: horas(cenario.horas) },
    { label: 'Mão de obra', value: brl(cenario.maoDeObraBrl) },
    { label: 'Custos diretos', value: brl(cenario.custosDiretosBrl) },
    { label: 'Subtotal', value: brl(cenario.subtotalBrl) },
    { label: 'Contingência', value: brl(cenario.contingenciaBrl) },
    { label: 'Total', value: brl(cenario.totalBrl), emphasis: true },
  ];
}

/**
 * Como o custo de IA deve aparecer (§2.6, §2.8).
 *
 * Duas decisões da spec viram texto aqui:
 * - **sem taxa de câmbio, o valor fica em USD e FORA do total em BRL** — e a
 *   tela precisa dizer isso, senão o número parece simplesmente omitido;
 * - **projeção leva rótulo mesmo quando calculada** — `isCalculated` diz *como*
 *   o número veio, não que ele deixou de ser estimativa.
 */
export function aiCostLines(estimate: EstimateDetail): {
  incurred: string;
  projected: string;
  projectedNote: string;
  /** Aviso de que o custo de IA não entrou no total em BRL. */
  outsideTotal: string | null;
} {
  const semTaxa = estimate.exchangeRate === null;
  const usd = (v: string) => `US$ ${Number(v).toFixed(4)}`;
  const emBrl = (v: string) =>
    semTaxa ? null : brl(String(Number(v) * Number(estimate.exchangeRate)));

  const incurredBrl = emBrl(estimate.aiCostIncurredUsd);
  const projectedBrl = emBrl(estimate.aiCostProjected.valueUsd);

  return {
    incurred: incurredBrl
      ? `${usd(estimate.aiCostIncurredUsd)} (${incurredBrl})`
      : usd(estimate.aiCostIncurredUsd),
    projected: projectedBrl
      ? `${usd(estimate.aiCostProjected.valueUsd)} (${projectedBrl})`
      : usd(estimate.aiCostProjected.valueUsd),
    projectedNote: estimate.aiCostProjected.isCalculated
      ? 'projeção — média das execuções do workspace'
      : 'projeção não calculada — histórico insuficiente',
    outsideTotal: semTaxa
      ? 'Sem taxa de câmbio informada: o custo de IA aparece em USD e NÃO entra no total em BRL.'
      : null,
  };
}

/**
 * Por que o botão de gerar decomposição não aparece.
 *
 * Responde à pergunta que a pessoa faz olhando a tela — sem isso ela vê um
 * painel vazio e nenhuma explicação. O texto do estado vem do servidor.
 */
export function effortBlockedReason(view: EffortBreakdownView): string | null {
  if (view.canGenerate) return null;
  if (view.state === 'BRIEFING_SUBMITTED') {
    return 'Os 4 artefatos precisam estar aprovados antes de decompor o esforço.';
  }
  if (
    view.state === 'CONTRACT_PENDING' ||
    view.state === 'CONTRACT_APPROVED' ||
    view.state === 'IN_PRODUCTION' ||
    view.state === 'DELIVERED'
  ) {
    // Já passou do ponto: a decomposição existente continua legível, mas gerar
    // outra sobre requisitos de um projeto em produção não é o que a pessoa
    // quer — e a rota recusaria de qualquer jeito.
    return 'O projeto já avançou no funil — a decomposição não é mais gerada aqui.';
  }
  return 'A decomposição só fica disponível depois que os artefatos são aprovados.';
}

/** As tarefas de uma versão do `effort_breakdown`, lidas do `jsonb`. */
export function tasksOf(content: unknown): EffortTaskView[] {
  if (typeof content !== 'object' || content === null) return [];
  const lista = (content as Record<string, unknown>).tarefas;
  if (!Array.isArray(lista)) return [];
  return lista.filter(
    (t): t is EffortTaskView =>
      typeof t === 'object' && t !== null && typeof (t as EffortTaskView).tarefa === 'string',
  );
}

/**
 * Requisitos que a IA deixou sem tarefa (§2.1 — *anota, não bloqueia*).
 *
 * Devolvido para a tela **mostrar**, nunca para desabilitar o botão de aprovar:
 * é o mesmo desenho do `ArtifactReviewer`, e transformar a anotação em bloqueio
 * daria à IA um veto por via indireta.
 */
export function gapsOf(content: unknown): string[] {
  if (typeof content !== 'object' || content === null) return [];
  const lista = (content as Record<string, unknown>).requisitosSemTarefa;
  if (!Array.isArray(lista)) return [];
  return lista.filter((r): r is string => typeof r === 'string');
}

/**
 * Se a estimativa já foi aprovada. **Aprovada não bloqueia reestimar** (§2.12) —
 * a versão nova fica disponível e o card não volta.
 */
export function isApproved(estimate: EstimateDetail): boolean {
  return estimate.approvedAt !== null;
}

/** Total do cenário provável — o número que a lista de versões mostra. */
export function headlineTotal(estimate: EstimateDetail): string {
  return brl(estimate.scenarios.provavel.totalBrl);
}
