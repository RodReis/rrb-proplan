import { extractJsonObject } from '../../../shared/extract-json';
import type { ArtifactKind } from './artifact-kind';

/**
 * As 4 capacidades geradoras (SPEC-032 §2.3), cada uma com prompt e **schema
 * obrigatório** (§2.5).
 *
 * A regra que organiza o arquivo: **resposta que não valida nunca vira
 * artefato**. Ela gera 1 retry e, persistindo, o artefato falha explicitamente
 * com motivo legível. Nunca artefato pela metade, nunca campo inventado para
 * completar o schema — um artefato plausível e errado é pior que artefato
 * nenhum, porque ninguém o revisa com desconfiança.
 *
 * `promptVersion` entra no `inputHash` (§2.8): mudar um prompt aqui **precisa**
 * invalidar o cache, senão a correção não teria efeito nenhum. Por isso a
 * versão é declarada por capacidade e não global — corrigir o `scope` não deve
 * regenerar o `normalize`, que ninguém mexeu.
 */

export class InvalidArtifactError extends Error {
  constructor(kind: ArtifactKind, reason: string) {
    super(`Resposta inválida para "${kind}": ${reason}`);
  }
}

export interface Capability {
  kind: ArtifactKind;
  /** Muda quando o prompt muda. Entra no `inputHash`. */
  promptVersion: string;
  system: string;
  /** Capacidades cuja saída esta consome. Ordem do §2.3. */
  consumes: readonly ArtifactKind[];
  maxTokens: number;
  /** Valida e devolve o conteúdo. Lança `InvalidArtifactError`. */
  parse: (text: string) => Record<string, unknown>;
}

/** Helper comum: extrai o objeto e falha com motivo legível, em português. */
function objectOf(kind: ArtifactKind, text: string): Record<string, unknown> {
  const json = extractJsonObject(text);
  if (!json) throw new InvalidArtifactError(kind, 'nenhum objeto JSON na resposta');
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new InvalidArtifactError(kind, 'JSON malformado');
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new InvalidArtifactError(kind, 'a raiz não é um objeto');
  }
  return parsed as Record<string, unknown>;
}

function textoObrigatorio(kind: ArtifactKind, o: Record<string, unknown>, campo: string): string {
  const v = o[campo];
  if (typeof v !== 'string' || v.trim() === '') {
    throw new InvalidArtifactError(kind, `campo "${campo}" ausente ou vazio`);
  }
  return v;
}

function listaDeTextos(
  kind: ArtifactKind,
  o: Record<string, unknown>,
  campo: string,
  minimo = 1,
): string[] {
  const v = o[campo];
  if (!Array.isArray(v)) throw new InvalidArtifactError(kind, `campo "${campo}" não é lista`);
  if (v.length < minimo) {
    throw new InvalidArtifactError(kind, `campo "${campo}" precisa de ao menos ${minimo} item`);
  }
  if (!v.every((i) => typeof i === 'string' && i.trim() !== '')) {
    // Lista com item vazio passaria numa checagem de tamanho e viraria bullet em
    // branco na tela — defeito que só aparece para quem lê o artefato.
    throw new InvalidArtifactError(kind, `campo "${campo}" tem item vazio ou não-texto`);
  }
  return v as string[];
}

const IDIOMA = 'Escreva em português (pt-BR).';

/**
 * Regra repetida em todos os prompts, e a mais importante deles.
 *
 * O MVP3 §9 proíbe número sem origem rastreável, e o ADR-012 diz que o LLM
 * decompõe e o código calcula. Um modelo que "estima 40 horas" produz um número
 * plausível que ninguém consegue auditar — e estimativa é da SPEC-033, onde a
 * conta é determinística.
 */
const SEM_INVENTAR =
  'Baseie-se APENAS no que o briefing diz. Não invente fatos, prazos, valores ' +
  'nem tecnologias que o cliente não mencionou. Quando algo não estiver no ' +
  'briefing, diga que não foi informado — ausência é informação, não lacuna a ' +
  'preencher. NÃO estime horas, prazos ou preços: isso é decidido depois, por ' +
  'cálculo, não por você.';

export const CAPABILITIES: readonly Capability[] = [
  {
    kind: 'normalize',
    promptVersion: 'normalize@1',
    consumes: [],
    maxTokens: 4000,
    system: `Você recebe as respostas cruas de um briefing preenchido por um cliente e as reescreve de forma organizada, sem perder informação.

Responda SOMENTE com um objeto JSON válido, no formato exato:
{"resumo": string, "objetivo": string, "publico": string, "pontosNaoInformados": string[]}

- resumo: o que o cliente pediu, em 3-5 frases corridas.
- objetivo: o que ele quer alcançar com isso, em 1-2 frases.
- publico: para quem é, em 1-2 frases. Se não informado, diga isso.
- pontosNaoInformados: lista do que ficaria faltando para executar o trabalho.

${SEM_INVENTAR}
${IDIOMA}`,
    parse: (text) => {
      const o = objectOf('normalize', text);
      return {
        resumo: textoObrigatorio('normalize', o, 'resumo'),
        objetivo: textoObrigatorio('normalize', o, 'objetivo'),
        publico: textoObrigatorio('normalize', o, 'publico'),
        // Lista pode ser VAZIA aqui, e isso é resultado, não falha: um briefing
        // completo não tem pontos faltando. Exigir ao menos um item obrigaria o
        // modelo a inventar uma lacuna para satisfazer o schema.
        pontosNaoInformados: listaDeTextos('normalize', o, 'pontosNaoInformados', 0),
      };
    },
  },
  {
    kind: 'scope',
    promptVersion: 'scope@1',
    consumes: ['normalize'],
    maxTokens: 4000,
    system: `Você recebe um briefing normalizado e delimita o escopo do trabalho.

Responda SOMENTE com um objeto JSON válido, no formato exato:
{"entregaveis": string[], "foraDeEscopo": string[], "premissas": string[], "riscos": string[]}

- entregaveis: o que será entregue, item a item (3-8 itens).
- foraDeEscopo: o que NÃO será feito, para evitar mal-entendido depois.
- premissas: o que se está assumindo como verdade para poder executar.
- riscos: o que pode dar errado ou atrasar.

${SEM_INVENTAR}
${IDIOMA}`,
    parse: (text) => {
      const o = objectOf('scope', text);
      return {
        entregaveis: listaDeTextos('scope', o, 'entregaveis', 1),
        // As três podem ser vazias: um trabalho pequeno pode não ter risco
        // relevante, e obrigar o modelo a listar um produziria risco decorativo.
        foraDeEscopo: listaDeTextos('scope', o, 'foraDeEscopo', 0),
        premissas: listaDeTextos('scope', o, 'premissas', 0),
        riscos: listaDeTextos('scope', o, 'riscos', 0),
      };
    },
  },
  {
    kind: 'requirements',
    promptVersion: 'requirements@1',
    consumes: ['normalize', 'scope'],
    maxTokens: 6000,
    system: `Você recebe um briefing normalizado e o escopo delimitado, e produz os requisitos priorizados.

Responda SOMENTE com um objeto JSON válido, no formato exato:
{"requisitos": [{"titulo": string, "descricao": string, "prioridade": "essencial" | "importante" | "desejavel"}]}

- Entre 5 e 20 requisitos.
- titulo: curto, o que precisa existir.
- descricao: 1-3 frases sobre o que significa estar pronto.
- prioridade: exatamente um dos três valores, sem variação.

${SEM_INVENTAR}
${IDIOMA}`,
    parse: (text) => {
      const o = objectOf('requirements', text);
      const lista = o.requisitos;
      if (!Array.isArray(lista) || lista.length === 0) {
        throw new InvalidArtifactError('requirements', 'campo "requisitos" ausente ou vazio');
      }
      const PRIORIDADES = ['essencial', 'importante', 'desejavel'];
      const requisitos = lista.map((item, i) => {
        if (typeof item !== 'object' || item === null) {
          throw new InvalidArtifactError('requirements', `requisito ${i + 1} não é objeto`);
        }
        const r = item as Record<string, unknown>;
        const prioridade = r.prioridade;
        // A prioridade é o campo que a SPEC-033 vai CONSUMIR para calcular. Um
        // valor fora da lista ("média", "alta") passaria como texto e quebraria
        // lá, longe daqui — barrar na origem é o que impede o defeito de viajar.
        if (typeof prioridade !== 'string' || !PRIORIDADES.includes(prioridade)) {
          throw new InvalidArtifactError(
            'requirements',
            `requisito ${i + 1} tem prioridade "${String(prioridade)}" fora de ${PRIORIDADES.join('|')}`,
          );
        }
        return {
          titulo: textoObrigatorio('requirements', r, 'titulo'),
          descricao: textoObrigatorio('requirements', r, 'descricao'),
          prioridade,
        };
      });
      return { requisitos };
    },
  },
  {
    kind: 'site_prompt',
    promptVersion: 'site_prompt@1',
    consumes: ['normalize', 'scope', 'requirements'],
    maxTokens: 4000,
    system: `Você recebe o briefing normalizado, o escopo e os requisitos, e escreve um prompt que outra ferramenta de IA usaria para gerar o site.

Responda SOMENTE com um objeto JSON válido, no formato exato:
{"prompt": string, "referencias": string[], "observacoes": string[]}

- prompt: o texto completo, pronto para colar numa ferramenta de geração. Deve descrever propósito, público, seções, tom e identidade visual.
- referencias: sites ou estilos que o cliente citou. Vazio se não citou nenhum.
- observacoes: o que quem for gerar precisa saber e não cabe no prompt.

${SEM_INVENTAR}
${IDIOMA}`,
    parse: (text) => {
      const o = objectOf('site_prompt', text);
      return {
        prompt: textoObrigatorio('site_prompt', o, 'prompt'),
        // Vazias por padrão: referência inventada é pior que ausente — mandaria
        // quem gera o site copiar um estilo que o cliente nunca pediu.
        referencias: listaDeTextos('site_prompt', o, 'referencias', 0),
        observacoes: listaDeTextos('site_prompt', o, 'observacoes', 0),
      };
    },
  },
];

/** Monta o conteúdo do usuário: o briefing e as saídas que a capacidade consome. */
export function buildUserMessage(
  cap: Capability,
  answers: unknown,
  upstream: Partial<Record<ArtifactKind, unknown>>,
): string {
  const partes = [`## Briefing do cliente\n\n${JSON.stringify(answers, null, 2)}`];
  for (const dependencia of cap.consumes) {
    const conteudo = upstream[dependencia];
    if (conteudo !== undefined) {
      partes.push(`## ${dependencia}\n\n${JSON.stringify(conteudo, null, 2)}`);
    }
  }
  return partes.join('\n\n---\n\n');
}
