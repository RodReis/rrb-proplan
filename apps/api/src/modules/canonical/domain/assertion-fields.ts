/**
 * Projeção das asserções humanas em `CanonicalField` (SPEC-015) — PURA.
 *
 * `entity = constraints` ("o que não mexer", #13 do modelo canônico),
 * `provenanceClass = assercao` — preenche o slot que a Fatia 9 deixou.
 * A fonte é docs/CONTEXT.md (via Assertion, índice reconstruível).
 *
 * Confiança determinística: `vigente` → cobertura 1.0; `a-revalidar` →
 * cobertura 0.5 (rebaixada, nunca omitida — a marca é obrigatória em toda
 * saída, e aqui ela também move o número). Staleness não se aplica: a validade
 * da asserção é o próprio mecanismo de idade (path citado mudou → rebaixa).
 */

import { computeConfidence } from './confidence';
import { ExtractedField } from './extract-fields';

export interface AssertionInput {
  statement: string;
  paths: string[];
  author: string;
  /** YYYY-MM-DD ('' = sem data, degradado). */
  assertedAt: string;
  assertedSha: string;
  status: 'vigente' | 'a-revalidar';
}

/** Slug estável do statement — chave `field` no unique (project, entity, field). */
export function assertionFieldKey(statement: string): string {
  return statement
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

export function assertionsToCanonicalFields(
  assertions: AssertionInput[],
  docsScopeHash: string,
): ExtractedField[] {
  // CONTEXT.md editado à mão pode ter duas seções com o mesmo statement — o
  // parser tolera (nunca quebra o sync), então o slug precisa desambiguar aqui,
  // senão o @@unique(projectId, entity, field) derruba o rebuild inteiro.
  const seen = new Map<string, number>();
  return assertions.map((a) => {
    const cobertura = a.status === 'vigente' ? 1.0 : 0.5;
    const { score, math } = computeConfidence({
      stalenessDays: 0,
      cobertura,
      contradicao: 0,
      drift: 0,
    });
    const base = assertionFieldKey(a.statement);
    const count = (seen.get(base) ?? 0) + 1;
    seen.set(base, count);
    return {
      entity: 'constraints',
      field: count === 1 ? base : `${base}-${count}`,
      value: { statement: a.statement, paths: a.paths },
      provenanceClass: 'assercao',
      provenanceRef: {
        author: a.author,
        date: a.assertedAt || null,
        sha: a.assertedSha || null,
        paths: a.paths,
        status: a.status,
      },
      confidence: score,
      confidenceMath: math,
      docsScopeHash,
    };
  });
}
