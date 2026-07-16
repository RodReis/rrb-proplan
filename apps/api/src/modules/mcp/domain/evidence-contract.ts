/**
 * Contrato de evidência (SPEC-016, Fatia 11) — domínio PURO, o coração do MCP.
 *
 * Toda resposta de toda tool passa por `enforceEvidenceContract`. A invariante,
 * sem exceção (§O contrato de evidência): **evidência vazia ⇒ a tool DEVE
 * recusar, nunca responder.** Não existe `answer` sem prova. Este é o corolário
 * do MVP2 — "um sistema que sabe recusar vale mais que um que sempre responde".
 *
 * A marca `a-revalidar` de uma asserção (Fatia 10) é evidência normal aqui; sua
 * propagação é responsabilidade de quem monta o `EvidenceItem` (o adaptador não
 * pode omiti-la — ADR-013), mas o contrato não a inventa nem a apaga.
 */

/** Um item de procedência datado. `fato` cita path+sha+data; `asserção` cita
 *  autor+data+sha+status. Ambos referenciam a fonte, nunca reproduzem o corpo. */
export interface EvidenceItem {
  type: 'fato' | 'asserção' | 'inferência';
  /** URL da fonte (issue, doc no GitHub) — referência, sem corpo (ADR-017). */
  url?: string;
  path?: string;
  sha?: string;
  date?: string | null;
  author?: string;
  /** Propagada de asserções da Fatia 10 — NUNCA omitida quando aplicável. */
  status?: 'vigente' | 'a-revalidar';
}

export interface Answer {
  answer: string;
  confidence: number;
  evidence: EvidenceItem[];
  refusal: null;
}

export interface Refusal {
  answer: null;
  confidence: number;
  evidence: [];
  /** O que falta para a tool poder responder — nunca um palpite. */
  refusal: { reason: string; missing: string };
}

export type ToolResult = Answer | Refusal;

/** O que o adaptador entrega ao contrato: uma resposta candidata. Se a evidência
 *  estiver vazia (ou o adaptador já saber que recusa), sai `Refusal`. */
export interface Candidate {
  answer: string | null;
  confidence: number;
  evidence: EvidenceItem[];
  /** Motivo pré-computado de recusa (ex.: abaixo do limiar da Fatia 9). Quando
   *  presente, força recusa mesmo que haja evidência. */
  refusalReason?: { reason: string; missing: string } | null;
}

/**
 * A invariante central, testável (critério de aceite §1). Retorna `Answer`
 * apenas quando há evidência E nenhum motivo de recusa pré-computado; caso
 * contrário `Refusal` com o que falta. Não há caminho que responda sem prova.
 */
export function enforceEvidenceContract(c: Candidate): ToolResult {
  if (c.refusalReason) {
    return refuse(c.confidence, c.refusalReason.reason, c.refusalReason.missing);
  }
  if (c.evidence.length === 0 || c.answer === null) {
    return refuse(
      c.confidence,
      'sem evidência datada para sustentar uma resposta',
      'sincronize o projeto ou confirme a fonte no GitHub',
    );
  }
  return {
    answer: c.answer,
    confidence: c.confidence,
    evidence: c.evidence,
    refusal: null,
  };
}

function refuse(confidence: number, reason: string, missing: string): Refusal {
  return { answer: null, confidence, evidence: [], refusal: { reason, missing } };
}
