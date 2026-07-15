/**
 * Extração determinística de `fato` (SPEC-014) — PURA, sem IA, sem banco.
 *
 * Transforma a resolução de documentos (Fatia 6) + o staleness (ADR-010) em
 * linhas `CanonicalField`, uma por entidade (campo `presence`, decisão do PI:
 * granularidade de documento). A confiança é determinística (computeConfidence).
 */

import { computeConfidence, ConfidenceSignals } from './confidence';
import { ProvenanceClass } from './canonical-model';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Resolução de uma entidade, achatada com o blob SHA do doc (proveniência fato). */
export interface ResolutionInput {
  entity: string;
  level: 1 | 2 | 3 | 4;
  source: string; // convention | alias | config | inference | absent
  path: string | null;
  paths: string[];
  /** blob SHA do doc resolvido (arquivo único). null p/ coleção/ausente. */
  sha: string | null;
}

export interface ExtractInput {
  resolutions: ResolutionInput[];
  /** Gap em dias entre último commit de código e de docs (>= 0). */
  stalenessDays: number;
  docsScopeHash: string;
  /** Data do último commit em docs (proveniência `fato`). null = desconhecida.
   *  Determinística por repo — NÃO usar a data de extração (quebraria o rebuild). */
  docsDate: string | null;
}

/** Linha pronta para persistir em CanonicalField (menos id/projectId/resolvedAt). */
export interface ExtractedField {
  entity: string;
  field: string;
  value: unknown;
  provenanceClass: ProvenanceClass;
  provenanceRef: unknown;
  confidence: number;
  confidenceMath: ConfidenceSignals;
  docsScopeHash: string;
}

/** Gap de staleness em dias inteiros; nunca negativo; datas nulas → 0. */
export function stalenessDaysBetween(
  lastDocsCommitAt: Date | null,
  lastCodeCommitAt: Date | null,
): number {
  if (!lastDocsCommitAt || !lastCodeCommitAt) return 0;
  const gap = (lastCodeCommitAt.getTime() - lastDocsCommitAt.getTime()) / MS_PER_DAY;
  return gap > 0 ? Math.round(gap) : 0;
}

export function extractCanonicalFields(input: ExtractInput): ExtractedField[] {
  return input.resolutions.map((r) => {
    const absent = r.level === 4 || r.source === 'absent';
    // cobertura já modula por nível de resolução (convenção 1.0 > alias 0.8 >
    // inferência varia > ausente 0). É o piso multiplicativo da confiança.
    const cobertura = absent ? 0 : coberturaFromLevel(r.level);
    const { score, math } = computeConfidence({
      stalenessDays: input.stalenessDays,
      cobertura,
      contradicao: 0,
      drift: 0,
    });

    return {
      entity: r.entity,
      field: 'presence',
      value: absent ? null : valueOf(r),
      provenanceClass: provenanceOf(r.source),
      provenanceRef: absent
        ? { absent: true }
        : { path: r.path, paths: r.paths.length ? r.paths : undefined, sha: r.sha, date: input.docsDate },
      confidence: score,
      confidenceMath: math,
      docsScopeHash: input.docsScopeHash,
    };
  });
}

/** Cobertura por nível (MVP2 §3): convenção > alias > inferência. */
function coberturaFromLevel(level: 1 | 2 | 3 | 4): number {
  switch (level) {
    case 1: return 1.0;   // convenção/config
    case 2: return 0.8;   // alias
    case 3: return 0.6;   // inferência (IA)
    default: return 0;    // ausente
  }
}

function provenanceOf(source: string): ProvenanceClass {
  return source === 'inference' ? 'inferencia' : 'fato';
}

function valueOf(r: ResolutionInput): unknown {
  if (r.path) return { path: r.path };
  if (r.paths.length) return { paths: r.paths };
  return null;
}
