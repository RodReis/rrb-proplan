import { extractJsonObject } from '../../../shared/extract-json';
import type { ArtifactKind } from './artifact-kind';

/**
 * O `ArtifactReviewer` (SPEC-032 §2.9) — **anota, nunca bloqueia**.
 *
 * A decisão 1 do PI é a regra inteira: o parecer aparece ao lado do artefato e
 * o botão de aprovar continua livre. Bloquear daria à IA **poder de veto por
 * via indireta**, que é o oposto do MVP3 §6 — e o pior tipo de veto, porque
 * ninguém decidiu concedê-lo: ele apareceria como efeito colateral de um campo.
 *
 * Por isso o veredito é **texto livre**, não enum, aqui e na coluna: um valor
 * `'reject'` num tipo fechado seria convite a alguém escrever
 * `WHERE verdict <> 'reject'` no caminho da aprovação. O tipo do dado defende a
 * decisão melhor que um comentário.
 *
 * O revisor **não roda sobre versão humana** (§7.4.3): ele opina sobre a saída
 * do modelo, dentro do run. IA opinando sobre texto do dono é ruído, e rodá-la
 * ali gastaria dinheiro num parecer que ninguém pediu.
 */

export const REVIEWER_PROMPT_VERSION = 'reviewer@1';

export const REVIEWER_SYSTEM = `Você revisa um artefato gerado por outra IA a partir de um briefing de cliente e aponta problemas para quem vai aprová-lo.

Responda SOMENTE com um objeto JSON válido, no formato exato:
{"veredito": string, "justificativa": string, "pontos": string[]}

- veredito: uma palavra ou expressão curta resumindo sua leitura (ex.: "consistente", "atenção", "incompleto").
- justificativa: 2-4 frases explicando o veredito.
- pontos: lista do que quem for aprovar deveria conferir. Vazia se não houver nada.

Você NÃO decide se o artefato é aprovado — quem decide é a pessoa. Seu papel é dizer o que ela deveria olhar antes.

Aponte especificamente: informação que o artefato afirma e o briefing não diz; pedido do briefing que o artefato ignorou; contradição interna.

Baseie-se APENAS no briefing e no artefato fornecidos. NÃO estime horas, prazos ou preços.
Escreva em português (pt-BR).`;

export interface ReviewOutput {
  veredito: string;
  justificativa: string;
  pontos: string[];
}

export class InvalidReviewError extends Error {
  constructor(reason: string) {
    super(`Parecer inválido: ${reason}`);
  }
}

export function parseReview(text: string): ReviewOutput {
  const json = extractJsonObject(text);
  if (!json) throw new InvalidReviewError('nenhum objeto JSON na resposta');
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new InvalidReviewError('JSON malformado');
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new InvalidReviewError('a raiz não é um objeto');
  }
  const o = parsed as Record<string, unknown>;

  if (typeof o.veredito !== 'string' || o.veredito.trim() === '') {
    throw new InvalidReviewError('campo "veredito" ausente ou vazio');
  }
  if (typeof o.justificativa !== 'string' || o.justificativa.trim() === '') {
    throw new InvalidReviewError('campo "justificativa" ausente ou vazio');
  }
  const pontos = o.pontos;
  if (!Array.isArray(pontos) || !pontos.every((p) => typeof p === 'string')) {
    throw new InvalidReviewError('campo "pontos" não é lista de textos');
  }

  return {
    veredito: o.veredito,
    justificativa: o.justificativa,
    // Vazia é resultado, não falha: um artefato sem problema não deve forçar o
    // modelo a inventar um ponto de atenção para satisfazer o schema.
    pontos: pontos as string[],
  };
}

/** Monta o insumo do revisor: o briefing e o artefato sob revisão. */
export function buildReviewUser(
  kind: ArtifactKind,
  answers: unknown,
  conteudo: unknown,
): string {
  return [
    `## Briefing do cliente\n\n${JSON.stringify(answers, null, 2)}`,
    `## Artefato gerado (${kind})\n\n${JSON.stringify(conteudo, null, 2)}`,
  ].join('\n\n---\n\n');
}
