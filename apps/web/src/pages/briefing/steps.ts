/**
 * As 9 etapas do briefing, do lado da tela (SPEC-031 §1).
 *
 * **Espelho** do `briefing-steps.ts` do domain da API — deliberadamente, não por
 * acidente. A spec é explícita: *"validação de tela é conveniência; a barreira é
 * a API"*. Isto aqui é a conveniência: evita um round-trip para descobrir que um
 * campo obrigatório está vazio. Quem decide é o servidor, e é ele quem devolve
 * 422 se este arquivo divergir.
 *
 * Por isso os nomes de campo e os valores de `oneOf` precisam bater exatamente
 * com o contrato do domain: campo fora do contrato é **recusado**, não ignorado.
 */

import type { MaskName } from './masks';

export const STEP_COUNT = 9;

export type FieldKind =
  | 'text'
  | 'textarea'
  | 'select'
  | 'list'
  | 'checkbox'
  /** Etapa 1: catálogo do tenant + item livre (spec §3). */
  | 'services'
  /** Etapa 1: cidades carregadas conforme o estado escolhido. */
  | 'city'
  /** Etapa 9: cartões com explicação em linguagem de cliente. */
  | 'complexity';

export interface FieldDef {
  name: string;
  label: string;
  kind: FieldKind;
  required?: boolean;
  /** Texto de apoio abaixo do campo — o que evita a pergunta por WhatsApp. */
  hint?: string;
  placeholder?: string;
  options?: readonly { value: string; label: string }[];
  /**
   * Máscara de digitação (pt-BR). **Só formata** — o contrato do domain aceita
   * estes campos como texto livre, e a barreira continua sendo a API.
   */
  mask?: MaskName;
}

export interface StepDef {
  n: number;
  title: string;
  /** Uma frase dizendo por que a etapa existe, na linguagem de quem responde. */
  intro: string;
  fields: readonly FieldDef[];
  /** Aviso fixo da etapa — a etapa 8 tem um que a spec exige em tela. */
  notice?: string;
}

/** Os três níveis da etapa 9, explicados SEM citar modelo de IA (spec §1). */
export const COMPLEXITY_OPTIONS = [
  {
    value: 'baixa',
    label: 'Baixa',
    description:
      'Projeto direto, com escopo já claro. A análise cobre o essencial e sai mais rápido.',
  },
  {
    value: 'media',
    label: 'Média',
    description:
      'Alguns pontos ainda em aberto. A análise entra em mais detalhe em cada etapa.',
  },
  {
    value: 'alta',
    label: 'Alta',
    description:
      'Muitas partes envolvidas ou requisitos incertos. A análise é a mais aprofundada.',
  },
] as const;

const KIND_OPTIONS = [
  { value: 'site_institucional', label: 'Site institucional' },
  { value: 'landing', label: 'Landing page' },
  { value: 'ecommerce', label: 'Loja virtual (e-commerce)' },
  { value: 'sistema_web', label: 'Sistema web' },
  { value: 'app', label: 'Aplicativo' },
] as const;

const URGENCY_OPTIONS = [
  { value: 'sem_pressa', label: 'Sem pressa' },
  { value: 'normal', label: 'Normal' },
  { value: 'urgente', label: 'Urgente' },
] as const;

const MODALITY_OPTIONS = [
  { value: 'desenvolvimento', label: 'Só o desenvolvimento' },
  { value: 'desenvolvimento_manutencao', label: 'Desenvolvimento + manutenção' },
  {
    value: 'desenvolvimento_venda_codigo',
    label: 'Desenvolvimento + venda do código',
  },
] as const;

export const STEPS: readonly StepDef[] = [
  {
    n: 1,
    title: 'Contexto do negócio',
    intro: 'Para começar, conte de onde você fala.',
    fields: [
      {
        name: 'company',
        label: 'Empresa ou seu nome',
        kind: 'text',
        required: true,
        placeholder: 'Como devemos chamar o projeto',
      },
      { name: 'segment', label: 'Segmento', kind: 'select', required: true },
      { name: 'state', label: 'Estado', kind: 'select' },
      { name: 'city', label: 'Cidade', kind: 'city' },
      {
        name: 'services',
        label: 'Produtos e serviços',
        kind: 'services',
        hint: 'Escolha da lista ou acrescente os seus — o que você digitar fica só nesta resposta.',
      },
    ],
  },
  {
    n: 2,
    title: 'Objetivo',
    intro: 'O que precisa mudar depois que este projeto existir.',
    fields: [
      {
        name: 'problem',
        label: 'Problema a resolver',
        kind: 'textarea',
        required: true,
        placeholder: 'O que hoje não funciona ou não existe',
      },
      {
        name: 'expected',
        label: 'Resultado esperado',
        kind: 'textarea',
        required: true,
        placeholder: 'Como as coisas ficam quando estiver pronto',
      },
      {
        name: 'success',
        label: 'Como saber que deu certo',
        kind: 'textarea',
        required: true,
        hint: 'Um sinal concreto: mais pedidos, menos ligações, tempo economizado.',
      },
    ],
  },
  {
    n: 3,
    title: 'Público e referências',
    intro: 'Quem vai usar, e o que você já viu por aí que gosta.',
    fields: [
      {
        name: 'audience',
        label: 'Quem vai usar',
        kind: 'textarea',
        placeholder: 'Seus clientes, sua equipe, o público em geral...',
      },
      {
        name: 'references',
        label: 'Sites de referência ou concorrentes',
        kind: 'list',
        placeholder: 'https://exemplo.com.br',
      },
      { name: 'likes', label: 'O que agrada neles', kind: 'textarea' },
      { name: 'dislikes', label: 'O que desagrada', kind: 'textarea' },
    ],
  },
  {
    n: 4,
    title: 'Solução e funcionalidades',
    intro: 'O formato do que você imagina.',
    fields: [
      {
        name: 'kind',
        label: 'Tipo de solução',
        kind: 'select',
        required: true,
        options: KIND_OPTIONS,
      },
      {
        name: 'features',
        label: 'Funcionalidades desejadas',
        kind: 'list',
        placeholder: 'Ex.: cadastro de clientes',
        hint: 'Uma por linha. Não precisa saber os nomes técnicos.',
      },
    ],
  },
  {
    n: 5,
    title: 'Conteúdo e identidade',
    intro: 'Quem produz o quê — isso muda bastante o tamanho do trabalho.',
    fields: [
      {
        name: 'contentProvider',
        label: 'Quem fornece textos e imagens',
        kind: 'textarea',
        placeholder: 'Você, sua equipe, ou precisa que a gente produza',
      },
      { name: 'hasLogo', label: 'Já tem logo e identidade visual', kind: 'text' },
      {
        name: 'domain',
        label: 'Domínio já existente',
        kind: 'text',
        placeholder: 'suaempresa.com.br',
      },
      { name: 'socials', label: 'Redes sociais', kind: 'list' },
    ],
  },
  {
    n: 6,
    title: 'Integrações e técnica',
    intro: 'O que já existe e vai precisar conversar com o novo.',
    fields: [
      { name: 'payment', label: 'Pagamento online', kind: 'text' },
      { name: 'whatsapp', label: 'WhatsApp', kind: 'text', mask: 'phone' },
      { name: 'erp', label: 'ERP ou sistema atual', kind: 'text' },
      { name: 'email', label: 'E-mail / disparos', kind: 'text' },
      { name: 'hosting', label: 'Hospedagem já contratada', kind: 'text' },
      {
        name: 'personalData',
        label: 'Coleta dados pessoais',
        kind: 'textarea',
        hint: 'Nome, CPF, endereço, dados de saúde — importa para a LGPD.',
      },
    ],
  },
  {
    n: 7,
    title: 'Prazo e orçamento',
    intro: 'Nada aqui é obrigatório, mas quanto mais souber, melhor a estimativa.',
    fields: [
      { name: 'desiredDate', label: 'Data desejada', kind: 'text', mask: 'date' },
      { name: 'urgency', label: 'Urgência', kind: 'select', options: URGENCY_OPTIONS },
      {
        name: 'budgetRange',
        label: 'Faixa de orçamento',
        kind: 'text',
        mask: 'currency',
        hint: 'Opcional. Ajuda a propor um escopo que caiba.',
      },
    ],
  },
  {
    n: 8,
    title: 'Modalidade preferida',
    intro: 'Como você prefere que o trabalho seja contratado.',
    // Exigido em tela pela spec §1: prometer o contrário criaria uma expectativa
    // que a estimativa (SPEC-032) vai quebrar.
    notice:
      'Isto é uma preferência, não um compromisso: a modalidade final é definida na proposta.',
    fields: [
      { name: 'modality', label: 'Modalidade', kind: 'select', options: MODALITY_OPTIONS },
    ],
  },
  {
    n: 9,
    title: 'Complexidade e envio',
    intro: 'Revise o que respondeu e confirme para enviar.',
    fields: [
      {
        name: 'complexity',
        label: 'Nível de complexidade',
        kind: 'complexity',
        required: true,
        // O `kind: 'complexity'` desenha os cartões no formulário e ignora
        // isto; quem lê `options` é quem só precisa do RÓTULO — a revisão da
        // etapa 9 e a leitura no painel (SPEC-031 §6). Sem a linha, as duas
        // mostram `alta` em vez de "Alta". Pego no dogfooding do PR-6.
        options: COMPLEXITY_OPTIONS,
      },
      { name: 'notes', label: 'Algo mais que queira contar', kind: 'textarea' },
      {
        name: 'confirmed',
        label: 'Confirmo que revisei as respostas e quero enviar',
        kind: 'checkbox',
        required: true,
        hint: 'Depois do envio as respostas não podem mais ser alteradas.',
      },
    ],
  },
] as const;

export function stepDef(n: number): StepDef | undefined {
  return STEPS.find((s) => s.n === n);
}

/** Vazio de verdade: `"   "` passaria por um `if (value)`. Igual ao domain. */
export function isBlank(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === 'string') return value.trim() === '';
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

export type StepAnswers = Record<string, unknown>;
export type Answers = Record<string, StepAnswers>;

/**
 * Campos obrigatórios vazios de uma etapa. Devolve os NOMES, não mensagens: quem
 * renderiza decide como falar do erro.
 */
export function missingFields(n: number, answers: StepAnswers): string[] {
  const def = stepDef(n);
  if (!def) return [];

  return def.fields
    .filter((f) => {
      if (!f.required) return false;
      // O checkbox da etapa 9 exige `true`, não "algo preenchido".
      if (f.kind === 'checkbox') return answers[f.name] !== true;
      return isBlank(answers[f.name]);
    })
    .map((f) => f.name);
}

/**
 * Remove os campos vazios antes de enviar.
 *
 * Ausência é informação (ADR-014): mandar `""` gravaria string vazia no `jsonb`
 * que alimenta o pipeline, o que é diferente de "não informado" — e o pipeline
 * não teria como distinguir os dois depois.
 */
export function pruneBlank(answers: StepAnswers): StepAnswers {
  const out: StepAnswers = {};
  for (const [key, value] of Object.entries(answers)) {
    if (!isBlank(value)) out[key] = value;
  }
  return out;
}
