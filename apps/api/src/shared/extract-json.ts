/**
 * Extrai o primeiro objeto JSON completo de um texto de modelo.
 *
 * Existe porque **modelo não obedece "responda só JSON"** de forma confiável:
 * vem cercado em ```json, com uma frase de cortesia antes, ou os dois. Recusar
 * a resposta inteira por causa da cortesia gastaria um retry — e o retry
 * também poderia vir com cortesia.
 *
 * O varredor conta chaves respeitando string e escape, em vez de regex: uma
 * chave dentro de string (`{"texto": "use { assim }"}`) quebraria o balanço
 * numa contagem ingênua, e o resultado seria um JSON truncado que falha no
 * `JSON.parse` — erro que pareceria "modelo devolveu lixo" quando na verdade
 * foi o extrator.
 *
 * Vive em `shared/` porque o `insight` (SPEC-003) e o `artifacts` (SPEC-032
 * §2.5) precisam exatamente disto, e `artifacts` importar de
 * `insight/domain/**` violaria o ADR-001.
 *
 * @returns o trecho `{...}` ou `null` se não houver objeto balanceado.
 */
export function extractJsonObject(text: string): string | null {
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
