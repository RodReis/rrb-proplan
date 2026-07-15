/**
 * Projeção de leitura do modelo canônico (SPEC-014) — PURA, sem IA, sem banco
 * (padrão activity-feed da Fatia 7). Monta o objeto entidades→campos a partir
 * das linhas `CanonicalField` já persistidas, aplicando a recusa por limiar.
 *
 * A granularidade é o CAMPO, não o documento (MVP2 §1): cada campo carrega sua
 * própria proveniência + confiança + a conta; abaixo do limiar → recusa
 * explícita, nunca um palpite.
 */

import { belowThreshold, ConfidenceSignals } from './confidence';

export type ProvenanceClass = 'fato' | 'inferencia' | 'hipotese' | 'assercao';

/** Linha crua do store (o que o CanonicalService lê do Prisma). */
export interface CanonicalFieldRow {
  entity: string;
  field: string;
  value: unknown;
  provenanceClass: ProvenanceClass;
  provenanceRef: unknown;
  confidence: number;
  confidenceMath: ConfidenceSignals;
}

export interface FieldPresent {
  refused: false;
  value: unknown;
  provenance: ProvenanceClass;
  provenanceRef: unknown;
  confidence: number;
  math: ConfidenceSignals;
}

export interface FieldRefused {
  refused: true;
  reason: string;
  /** O que confirmaria/preencheria — o link do que falta. */
  missing: unknown;
  confidence: number;
  math: ConfidenceSignals;
}

export type FieldView = FieldPresent | FieldRefused;

export interface CanonicalModel {
  entities: Record<string, { fields: Record<string, FieldView> }>;
}

/**
 * Monta o modelo. `threshold` vem de Settings (padrão 0.4; 0 desliga a recusa).
 * Não muta as linhas de entrada.
 */
export function assembleCanonicalModel(
  rows: CanonicalFieldRow[],
  threshold: number,
): CanonicalModel {
  const entities: CanonicalModel['entities'] = {};
  for (const r of rows) {
    if (!entities[r.entity]) entities[r.entity] = { fields: {} };
    entities[r.entity].fields[r.field] = toView(r, threshold);
  }
  return { entities };
}

function toView(r: CanonicalFieldRow, threshold: number): FieldView {
  if (belowThreshold(r.confidence, threshold)) {
    return {
      refused: true,
      reason: 'ausente ou defasado — confiança abaixo do limiar',
      missing: r.provenanceRef,
      confidence: r.confidence,
      math: r.confidenceMath,
    };
  }
  return {
    refused: false,
    value: r.value,
    provenance: r.provenanceClass,
    provenanceRef: r.provenanceRef,
    confidence: r.confidence,
    math: r.confidenceMath,
  };
}
