/**
 * `get_next_task` (SPEC-016) — julgamento PURO: qual issue o agente deve pegar.
 *
 * Combina board (Fatia 5), constraints (Fatia 10) e confiança (Fatia 9). A saída
 * referencia a issue por número+URL — NUNCA reproduz o corpo (ADR-017). A decisão
 * cita a evidência que excluiu cada candidato descartado:
 *   - constraint `a-revalidar` que toca o card → exclui (o fosso é lei);
 *   - confiança geral abaixo do limiar → recusa (não chuta prioridade).
 *
 * "Decisão de arquitetura nunca tomada" (o caso #38 da spec) é modelado como um
 * `blocker` já derivado por `find-blockers` e passado aqui como exclusão — este
 * domínio não reinfere; consome o que a fatia anterior calculou.
 */

export interface TaskCandidate {
  number: number;
  url: string;
  /** Título é rótulo datado, não o fato vivo (ADR-017). Só para a decisão legível. */
  title: string;
  /** 0 = alta … maior = menor prioridade (ordem estável do board). */
  priorityRank: number;
}

/** Uma exclusão nomeada: por que um candidato NÃO é a próxima tarefa. */
export interface Exclusion {
  number: number;
  /** "restrição a-revalidar" | "bloqueio: decisão ausente" — a evidência. */
  reason: string;
}

export interface NextTaskInput {
  /** Cards na coluna "A Fazer", já ordenados por prioridade (board). */
  candidates: TaskCandidate[];
  /** Números de issue bloqueados (constraint que os toca, ou blocker derivado). */
  excluded: Exclusion[];
  /** Confiança do estado do projeto (Fatia 9) — abaixo do limiar não recomenda. */
  stateConfidence: number;
  belowThreshold: boolean;
}

export interface NextTaskDecision {
  /** A issue escolhida (número+URL+título), ou null se nada elegível/recusa. */
  pick: TaskCandidate | null;
  /** Candidatos descartados com o motivo — a transparência da decisão. */
  excluded: Exclusion[];
  /** Preenchido quando não há pick: por que não recomendamos nada. */
  refusal: { reason: string; missing: string } | null;
}

/**
 * Determinístico: o primeiro candidato (maior prioridade) não-excluído vence.
 * Sem candidatos elegíveis, ou estado abaixo do limiar → recusa com o que falta.
 */
export function nextTask(input: NextTaskInput): NextTaskDecision {
  const excludedNumbers = new Set(input.excluded.map((e) => e.number));

  if (input.belowThreshold) {
    return {
      pick: null,
      excluded: input.excluded,
      refusal: {
        reason: 'confiança do estado do projeto abaixo do limiar (Fatia 9)',
        missing: 'sincronize e atualize a documentação antes de recomendar uma tarefa',
      },
    };
  }

  const pick =
    input.candidates
      .filter((c) => !excludedNumbers.has(c.number))
      .sort((a, b) => a.priorityRank - b.priorityRank)[0] ?? null;

  if (!pick) {
    return {
      pick: null,
      excluded: input.excluded,
      refusal: {
        reason:
          input.candidates.length === 0
            ? 'nenhuma issue em "A Fazer"'
            : 'toda issue candidata está bloqueada por restrição ou decisão pendente',
        missing:
          'crie uma issue em "A Fazer", ou resolva o bloqueio (revalide a restrição / tome a decisão de arquitetura)',
      },
    };
  }

  return { pick, excluded: input.excluded, refusal: null };
}
