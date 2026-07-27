/**
 * As 9 etapas do briefing público (SPEC-031 §1).
 *
 * Regra de negócio PURA — sem Prisma, sem HTTP, sem Nest. É a **barreira**: a
 * spec diz que "validação de tela é conveniência; a barreira é a API", e essa
 * frase só é verdade se a validação morar aqui, longe do controller.
 *
 * Duas decisões que a spec fixa e este módulo executa:
 *
 * 1. **Só as etapas 1, 2, 4 e 9 têm campo obrigatório.** As demais podem ser
 *    enviadas vazias — ausência é informação (ADR-014), e o pipeline recebe
 *    "não informado" em vez de um valor inventado.
 * 2. **A etapa 9 nunca cita modelo de IA.** O nível é `baixa|media|alta` e o
 *    mapeamento nível→modelo é configuração interna que não chega nesta fatia.
 */

export const STEP_COUNT = 9;

export type Complexity = 'baixa' | 'media' | 'alta';

export const COMPLEXITY_LEVELS: readonly Complexity[] = ['baixa', 'media', 'alta'];

/** Respostas de UMA etapa. Valor é escalar ou lista — nunca objeto aninhado. */
export type StepAnswers = Record<string, unknown>;

/** Respostas do briefing inteiro, indexadas pelo número da etapa. */
export type Answers = Record<number | string, StepAnswers>;

export interface FieldError {
  step: number;
  field: string;
  message: string;
}

export type ValidationResult =
  | { ok: true; errors: [] }
  | { ok: false; errors: FieldError[] };

interface FieldSpec {
  /** Vazio não passa. Só as etapas 1, 2, 4 e 9 têm campo assim. */
  required?: boolean;
  /** Conjunto fechado de valores — o que blinda a etapa 9 contra nome de modelo. */
  oneOf?: readonly string[];
  /** `true` obrigatório (a confirmação da etapa 9). */
  mustBeTrue?: boolean;
  /** Lista de strings livres (referências, funcionalidades, anexos...). */
  list?: boolean;
}

const KIND_OPTIONS = [
  'site_institucional',
  'landing',
  'ecommerce',
  'sistema_web',
  'app',
  // Sistema web + app é o pedido mais comum de quem já tem operação: o mesmo
  // backend servindo painel e celular. Sem a opção, quem quer os dois marcava um
  // e explicava o outro em texto livre — e a estimativa (SPEC-033) leria só um.
  'sistema_web_app',
] as const;

const URGENCY_OPTIONS = ['sem_pressa', 'normal', 'urgente'] as const;

const MODALITY_OPTIONS = [
  'desenvolvimento',
  'desenvolvimento_manutencao',
  'desenvolvimento_venda_codigo',
] as const;

/**
 * O contrato de cada etapa. A tabela do §1 da spec, em código.
 *
 * Campo que não está aqui é **recusado**, não ignorado: o payload alimenta um
 * `jsonb` que vira entrada do pipeline de IA, então aceitar chave arbitrária
 * deixaria quem tem o link gravar o que quisesse lá dentro. É também o que
 * cumpre o critério de isolamento — `tenantId`/`workspaceId` caem aqui.
 */
const STEPS: Record<number, Record<string, FieldSpec>> = {
  // 1 — Contexto do negócio
  1: {
    company: { required: true },
    segment: { required: true },
    state: {},
    city: {},
    services: { list: true },
  },
  // 2 — Objetivo
  2: {
    problem: { required: true },
    expected: { required: true },
    success: { required: true },
  },
  // 3 — Público e referências
  3: {
    audience: {},
    references: { list: true },
    likes: {},
    dislikes: {},
  },
  // 4 — Solução e funcionalidades
  4: {
    kind: { required: true, oneOf: KIND_OPTIONS },
    features: { list: true },
  },
  // 5 — Conteúdo e identidade
  5: {
    contentProvider: {},
    hasLogo: {},
    domain: {},
    socials: { list: true },
  },
  // 6 — Integrações e técnica
  6: {
    payment: {},
    whatsapp: {},
    erp: {},
    email: {},
    hosting: {},
    personalData: {},
  },
  // 7 — Prazo e orçamento (a faixa é OPCIONAL por decisão da spec)
  7: {
    desiredDate: {},
    urgency: { oneOf: URGENCY_OPTIONS },
    budgetRange: {},
  },
  // 8 — Modalidade preferida (preferência, nunca vinculante — MVP3 §2)
  8: {
    modality: { oneOf: MODALITY_OPTIONS },
  },
  // 9 — Complexidade, revisão e envio
  9: {
    complexity: { required: true, oneOf: COMPLEXITY_LEVELS },
    confirmed: { required: true, mustBeTrue: true },
    notes: {},
  },
};

export function isValidStep(step: number): boolean {
  return Number.isInteger(step) && step >= 1 && step <= STEP_COUNT;
}

/** Campos obrigatórios de uma etapa — vazio para as opcionais. */
export function requiredFieldsOf(step: number): string[] {
  const spec = STEPS[step];
  if (!spec) return [];
  return Object.entries(spec)
    .filter(([, f]) => f.required)
    .map(([name]) => name);
}

/** Vazio de verdade: `"   "` é truthy em JS e passaria por um `if (value)`. */
function isBlank(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === 'string') return value.trim() === '';
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

export function validateStep(step: number, answers: StepAnswers): ValidationResult {
  const spec = STEPS[step];
  if (!spec) {
    return {
      ok: false,
      errors: [{ step, field: '_step', message: 'etapa desconhecida' }],
    };
  }

  const errors: FieldError[] = [];

  // Chave fora do contrato: recusa explícita.
  for (const field of Object.keys(answers)) {
    if (!(field in spec)) {
      errors.push({ step, field, message: 'campo desconhecido' });
    }
  }

  for (const [field, rules] of Object.entries(spec)) {
    const value = answers[field];
    const blank = isBlank(value);

    if (rules.required && blank && !rules.mustBeTrue) {
      errors.push({ step, field, message: 'obrigatório' });
      continue;
    }

    if (rules.mustBeTrue && value !== true) {
      errors.push({ step, field, message: 'confirmação obrigatória' });
      continue;
    }

    if (blank) continue; // opcional não respondido: ausência é informação.

    if (rules.oneOf && !rules.oneOf.includes(value as string)) {
      errors.push({ step, field, message: 'valor fora das opções' });
    }

    if (rules.list && !Array.isArray(value)) {
      errors.push({ step, field, message: 'esperava uma lista' });
    }

    if (!rules.list && !rules.mustBeTrue && typeof value === 'object') {
      errors.push({ step, field, message: 'esperava um valor simples' });
    }
  }

  return errors.length === 0
    ? { ok: true, errors: [] }
    : { ok: false, errors };
}

/**
 * Aplica o save de UMA etapa sobre as respostas existentes.
 *
 * Imutável de propósito: o chamador compara antes/depois (o 1º save move o card
 * no funil), e mutar o objeto original apagaria a diferença que ele precisa ver.
 */
export function mergeAnswers(
  current: Answers,
  step: number,
  answers: StepAnswers,
): Answers {
  return { ...current, [step]: { ...answers } };
}

/** Uma etapa está concluída quando o que foi respondido nela é válido. */
function isStepComplete(step: number, answers: Answers): boolean {
  const stepAnswers = answers[step];
  if (!stepAnswers) return false;

  const respondeuAlgo = Object.values(stepAnswers).some((v) => !isBlank(v));
  if (!respondeuAlgo) return false;

  return validateStep(step, stepAnswers).ok;
}

/** Progresso para o painel do prestador ("em preenchimento, 4 de 9"). */
export function completedStepCount(answers: Answers): number {
  let count = 0;
  for (let step = 1; step <= STEP_COUNT; step++) {
    if (isStepComplete(step, answers)) count++;
  }
  return count;
}

/**
 * A barreira do submit: todas as etapas com campo obrigatório precisam estar
 * válidas. As opcionais podem estar ausentes — e ausentes elas seguem, sem
 * virar string vazia no `jsonb`.
 */
export function validateAllSteps(answers: Answers): ValidationResult {
  const errors: FieldError[] = [];

  for (let step = 1; step <= STEP_COUNT; step++) {
    const required = requiredFieldsOf(step);
    const stepAnswers = answers[step];

    if (required.length === 0) {
      // Opcional: valida só se veio algo.
      if (stepAnswers) {
        const out = validateStep(step, stepAnswers);
        if (!out.ok) errors.push(...out.errors);
      }
      continue;
    }

    if (!stepAnswers) {
      errors.push(
        ...required.map((field) => ({ step, field, message: 'obrigatório' })),
      );
      continue;
    }

    const out = validateStep(step, stepAnswers);
    if (!out.ok) errors.push(...out.errors);
  }

  return errors.length === 0
    ? { ok: true, errors: [] }
    : { ok: false, errors };
}
