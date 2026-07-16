/**
 * Ponte PURA entre o modelo canônico (Fatia 9/10) e o contrato de evidência
 * (SPEC-016). Converte a proveniência de um campo canônico num `EvidenceItem`.
 *
 * Invariante do produto (critério de aceite §2, ADR-013): o `status` de uma
 * asserção (`vigente`/`a-revalidar`) é SEMPRE copiado quando presente — nunca
 * omitido. Este helper é o único ponto que lê o `provenanceRef` das asserções;
 * o teste de que a marca nunca some ancora aqui.
 */

import { EvidenceItem } from './evidence-contract';
import { ProvenanceClass } from '../../canonical/domain/canonical-model';

const CLASS_TO_TYPE: Record<ProvenanceClass, EvidenceItem['type']> = {
  fato: 'fato',
  assercao: 'asserção',
  inferencia: 'inferência',
  hipotese: 'inferência',
};

/** Monta o item de evidência a partir da classe + ref de proveniência do campo.
 *  `url` é opcional (nem todo ref tem link direto); path/sha/date/author/status
 *  saem do ref quando existem. */
export function fieldToEvidence(
  provenanceClass: ProvenanceClass,
  provenanceRef: unknown,
): EvidenceItem {
  const ref = (provenanceRef ?? {}) as Record<string, unknown>;
  const item: EvidenceItem = { type: CLASS_TO_TYPE[provenanceClass] ?? 'fato' };

  if (typeof ref.url === 'string') item.url = ref.url;
  if (typeof ref.path === 'string') item.path = ref.path;
  else if (Array.isArray(ref.paths) && typeof ref.paths[0] === 'string') item.path = ref.paths[0];
  if (typeof ref.sha === 'string') item.sha = ref.sha;
  if (typeof ref.date === 'string' || ref.date === null) item.date = ref.date as string | null;
  if (typeof ref.author === 'string') item.author = ref.author;

  // A marca da asserção NUNCA é omitida quando presente (ADR-013).
  if (ref.status === 'vigente' || ref.status === 'a-revalidar') item.status = ref.status;

  return item;
}
