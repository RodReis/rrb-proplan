/** Resumo de estado do projeto (artefato de IA, versionado por hash). */
export interface StateSummary {
  oQueE: string;
  ondeParou: string;
  oQueFalta: string[];
}

export class InvalidSummaryError extends Error {
  constructor(reason: string) {
    super(`Resposta da IA inválida: ${reason}`);
  }
}

/**
 * Extrai e valida o JSON estrito do resumo a partir do texto do modelo.
 * Tolera cercas ```json e texto ao redor; exige as 3 chaves com os tipos
 * certos. Lança InvalidSummaryError (o caller faz 1 retry — SPEC-003).
 */
export function parseSummary(text: string): StateSummary {
  const json = extractJsonObject(text);
  if (!json) throw new InvalidSummaryError('nenhum objeto JSON encontrado');

  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new InvalidSummaryError('JSON malformado');
  }

  if (typeof parsed !== 'object' || parsed === null) {
    throw new InvalidSummaryError('não é objeto');
  }
  const o = parsed as Record<string, unknown>;

  if (typeof o.oQueE !== 'string' || o.oQueE.trim() === '') {
    throw new InvalidSummaryError('oQueE ausente ou vazio');
  }
  if (typeof o.ondeParou !== 'string' || o.ondeParou.trim() === '') {
    throw new InvalidSummaryError('ondeParou ausente ou vazio');
  }
  if (
    !Array.isArray(o.oQueFalta) ||
    !o.oQueFalta.every((x) => typeof x === 'string')
  ) {
    throw new InvalidSummaryError('oQueFalta deve ser array de strings');
  }

  return {
    oQueE: o.oQueE,
    ondeParou: o.ondeParou,
    oQueFalta: o.oQueFalta as string[],
  };
}

/** Isola o primeiro objeto JSON balanceado no texto (ignora cercas/prosa). */
function extractJsonObject(text: string): string | null {
  const start = text.indexOf('{');
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}
