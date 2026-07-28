import { extractJsonObject } from '../../../shared/extract-json';

/**
 * A 5ª capacidade: `EffortEstimator` (SPEC-033 §2.1).
 *
 * **Ela decompõe e só isso.** Nunca soma, nunca aplica multiplicador, nunca
 * decide preço — o cálculo é do código (`domain/calculation.ts`, PR-3), e a
 * separação não é preferência de arquitetura: erro de aritmética de um modelo de
 * linguagem é plausível, e erro de soma numa estimativa **não aparece como
 * falha**. Aparece como proposta enviada ao cliente.
 *
 * Por isso o prompt proíbe totais explicitamente e o schema **não tem onde
 * guardá-los**: se o modelo somar mesmo assim, o número não tem campo para
 * entrar. Proibir no texto e aceitar no schema deixaria a proibição valendo só
 * enquanto o modelo obedecesse.
 */

export class InvalidEffortError extends Error {
  constructor(reason: string) {
    super(`Resposta inválida para "effort_breakdown": ${reason}`);
  }
}

/** Uma tarefa proposta pela IA, com faixa de horas. */
export interface EffortTask {
  requisito: string;
  tarefa: string;
  horasMin: number;
  horasProvavel: number;
  horasMax: number;
  /** Grupo de entrega: `MVP1`, `MVP2`… Usado no agrupamento do §2.9. */
  mvp: string;
}

export interface EffortBreakdown {
  tarefas: EffortTask[];
}

export const EFFORT_PROMPT_VERSION = 'effort_breakdown@1';
export const EFFORT_MAX_TOKENS = 8000;

export const EFFORT_SYSTEM = `Você recebe os requisitos aprovados de um projeto de software e os decompõe em tarefas de execução, estimando uma FAIXA de horas para cada uma.

Responda SOMENTE com um objeto JSON válido, no formato exato:
{"tarefas": [{"requisito": string, "tarefa": string, "horasMin": number, "horasProvavel": number, "horasMax": number, "mvp": string}]}

- requisito: o título EXATO do requisito de onde a tarefa saiu, copiado sem alterar.
- tarefa: o que precisa ser feito, em uma frase. Concreto e verificável.
- horasMin: cenário otimista — tudo dá certo.
- horasProvavel: o caso realista.
- horasMax: cenário pessimista — o que você faria se aparecesse complicação.
- Os três valores obedecem SEMPRE horasMin <= horasProvavel <= horasMax.
- mvp: em que entrega esta tarefa cabe — "MVP1" para o que é indispensável no primeiro corte, "MVP2" para o seguinte, e assim por diante. Requisito essencial normalmente é MVP1.
- Cada requisito recebido precisa gerar AO MENOS uma tarefa. Pode gerar várias.

NÃO some nada. NÃO calcule totais, subtotais, preços, prazos em dias nem valores em dinheiro. Some é trabalho de quem recebe esta lista — e uma soma feita por você entraria numa proposta comercial sem ninguém conferir. Sua tarefa é decompor e estimar cada item isoladamente.

NÃO invente requisitos que não estão na lista recebida. Se um requisito for vago demais para estimar, ainda assim gere a tarefa e use uma faixa larga — a largura da faixa É a sua forma de dizer que há incerteza.

Escreva em português (pt-BR).`;

/** Extrai o objeto raiz, com motivo legível em português. */
function objetoDe(text: string): Record<string, unknown> {
  const json = extractJsonObject(text);
  if (!json) throw new InvalidEffortError('nenhum objeto JSON na resposta');
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new InvalidEffortError('JSON malformado');
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new InvalidEffortError('a raiz não é um objeto');
  }
  return parsed as Record<string, unknown>;
}

function textoObrigatorio(o: Record<string, unknown>, campo: string, i: number): string {
  const v = o[campo];
  if (typeof v !== 'string' || v.trim() === '') {
    throw new InvalidEffortError(`tarefa ${i + 1}: campo "${campo}" ausente ou vazio`);
  }
  return v.trim();
}

/**
 * Horas: número **finito, positivo e não absurdo**.
 *
 * As três checagens pegam falhas diferentes, e nenhuma é teórica:
 * - `NaN`/`Infinity` entram por JSON com `1e999` e sobrevivem a qualquer soma,
 *   contaminando o total inteiro sem nunca lançar erro.
 * - zero ou negativo produziria tarefa que "não custa nada" — e uma linha de
 *   -8 h reduziria o orçamento em silêncio.
 * - o teto de 2000 h (~1 ano de trabalho de uma pessoa) barra o dígito a mais:
 *   `800` virando `8000` não parece errado numa lista de 30 linhas, mas
 *   multiplica a proposta por dez.
 */
function horas(o: Record<string, unknown>, campo: string, i: number): number {
  const v = o[campo];
  if (typeof v !== 'number' || !Number.isFinite(v)) {
    throw new InvalidEffortError(`tarefa ${i + 1}: "${campo}" não é número finito`);
  }
  if (v <= 0) {
    throw new InvalidEffortError(`tarefa ${i + 1}: "${campo}" precisa ser maior que zero`);
  }
  if (v > MAX_HORAS_POR_TAREFA) {
    throw new InvalidEffortError(
      `tarefa ${i + 1}: "${campo}" = ${v} h passa do limite de ${MAX_HORAS_POR_TAREFA} h por tarefa`,
    );
  }
  return v;
}

/** ~1 ano de trabalho de uma pessoa. Tarefa maior que isso é erro de digitação. */
export const MAX_HORAS_POR_TAREFA = 2000;

/**
 * Valida a resposta e devolve o conteúdo. Lança `InvalidEffortError`.
 *
 * `requisitosEsperados` vem da versão aprovada de `requirements`: é o que
 * permite recusar tarefa pendurada num requisito que não existe. Sem essa
 * checagem, o modelo poderia inventar um requisito, a tarefa entraria na conta,
 * e o total ficaria maior por um trabalho que ninguém pediu — plausível e
 * errado, que é o pior formato.
 */
export function parseEffort(
  text: string,
  requisitosEsperados: readonly string[],
): EffortBreakdown {
  const o = objetoDe(text);
  const lista = o.tarefas;
  if (!Array.isArray(lista) || lista.length === 0) {
    throw new InvalidEffortError('campo "tarefas" ausente ou vazio');
  }

  const conhecidos = new Set(requisitosEsperados);

  const tarefas: EffortTask[] = lista.map((item, i) => {
    if (typeof item !== 'object' || item === null) {
      throw new InvalidEffortError(`tarefa ${i + 1} não é objeto`);
    }
    const t = item as Record<string, unknown>;

    const requisito = textoObrigatorio(t, 'requisito', i);
    if (conhecidos.size > 0 && !conhecidos.has(requisito)) {
      throw new InvalidEffortError(
        `tarefa ${i + 1} aponta para o requisito "${requisito}", que não está na lista aprovada`,
      );
    }

    const horasMin = horas(t, 'horasMin', i);
    const horasProvavel = horas(t, 'horasProvavel', i);
    const horasMax = horas(t, 'horasMax', i);

    // A ordem é critério de aceite (§5) e a barreira mais importante deste
    // arquivo. Uma faixa invertida (min > max) não quebra nada na hora: os três
    // cenários continuam somando, e o "otimista" simplesmente sai MAIOR que o
    // "pessimista" — um resultado que ninguém lê como defeito, só como estranho.
    if (!(horasMin <= horasProvavel && horasProvavel <= horasMax)) {
      throw new InvalidEffortError(
        `tarefa ${i + 1}: a faixa precisa obedecer min <= provável <= máx ` +
          `(recebido ${horasMin} / ${horasProvavel} / ${horasMax})`,
      );
    }

    return {
      requisito,
      tarefa: textoObrigatorio(t, 'tarefa', i),
      horasMin,
      horasProvavel,
      horasMax,
      mvp: textoObrigatorio(t, 'mvp', i),
    };
  });

  return { tarefas };
}

/**
 * Requisitos que ficaram **sem nenhuma tarefa**.
 *
 * Devolvido em vez de lançado: o §5 pede "1+ tarefas por requisito priorizado",
 * e recusar o artefato inteiro por causa de um requisito esquecido jogaria fora
 * as outras 29 tarefas boas — pagando o modelo de novo por elas. A lacuna é
 * mostrada na tela para o humano decidir (regenerar ou completar à mão), que é o
 * mesmo desenho do revisor: **anota, não bloqueia**.
 */
export function requisitosSemTarefa(
  breakdown: EffortBreakdown,
  requisitosEsperados: readonly string[],
): string[] {
  const cobertos = new Set(breakdown.tarefas.map((t) => t.requisito));
  return requisitosEsperados.filter((r) => !cobertos.has(r));
}

/** Monta o conteúdo do usuário: os requisitos aprovados, e nada além disso. */
export function buildEffortUser(requirements: unknown): string {
  return `## Requisitos aprovados\n\n${JSON.stringify(requirements, null, 2)}`;
}

/**
 * Os títulos dos requisitos de uma `ArtifactVersion.content` de `requirements`.
 *
 * Lê defensivamente porque o conteúdo vem do `jsonb` e **pode ter sido editado à
 * mão** (§2.10 da SPEC-032: a versão corrente pode ser `human`). Uma edição
 * humana não passa pelo schema da capacidade — nada garante a forma aqui, então
 * um `content` fora do formato devolve lista vazia em vez de estourar, e a
 * checagem de requisito desconhecido simplesmente não se aplica.
 */
export function titulosDeRequisitos(content: unknown): string[] {
  if (typeof content !== 'object' || content === null) return [];
  const lista = (content as Record<string, unknown>).requisitos;
  if (!Array.isArray(lista)) return [];
  return lista
    .map((r) =>
      typeof r === 'object' && r !== null
        ? (r as Record<string, unknown>).titulo
        : undefined,
    )
    .filter((t): t is string => typeof t === 'string' && t.trim() !== '')
    .map((t) => t.trim());
}
