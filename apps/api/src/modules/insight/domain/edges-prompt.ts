export interface InferredEdge {
  sourcePath: string;
  targetPath: string;
  reason: string;
}

export const EDGES_SYSTEM = `Você relaciona documentos de um repositório. Recebe uma lista de documentos (path, título, headings, início do texto) e os links explícitos já existentes entre eles. Sua tarefa: apontar relações SEMÂNTICAS reais NÃO cobertas por link explícito — quando dois documentos claramente tratam do mesmo assunto, um depende do outro, ou um detalha o que o outro menciona.

Regras:
- Só relações que se sustentam pelo conteúdo. Na dúvida, NÃO relacione.
- NÃO repita um par que já é link explícito.
- NÃO relacione um documento a si mesmo.
- Responda SÓ com um array JSON, sem prosa: [{"sourcePath","targetPath","motivo"}]. "motivo" é uma frase curta em pt-BR.`;

export function buildEdgesUser(
  docs: { path: string; title: string; headings: string[]; excerpt: string }[],
  explicitPairs: { source: string; target: string }[],
): string {
  const docList = docs
    .map((d) => `### ${d.path}\nTítulo: ${d.title}\nHeadings: ${d.headings.join(' · ')}\n${d.excerpt}`)
    .join('\n\n');
  const explicit = explicitPairs.map((p) => `${p.source} → ${p.target}`).join('\n') || '(nenhum)';
  return `Documentos:\n\n${docList}\n\nLinks explícitos já existentes (NÃO repita):\n${explicit}`;
}

export function parseEdges(text: string): InferredEdge[] {
  const arr = extractJsonArray(text);
  return arr
    .filter((x): x is Record<string, unknown> => typeof x === 'object' && x !== null)
    .map((x) => ({ sourcePath: x.sourcePath, targetPath: x.targetPath, reason: x.motivo }))
    .filter((e): e is InferredEdge =>
      typeof e.sourcePath === 'string' &&
      typeof e.targetPath === 'string' &&
      typeof e.reason === 'string' &&
      e.sourcePath !== e.targetPath &&
      e.sourcePath !== '' &&
      e.targetPath !== '',
    );
}

function extractJsonArray(text: string): unknown[] {
  const start = text.indexOf('[');
  if (start === -1) throw new Error('nenhum array JSON');
  let depth = 0,
    inStr = false,
    esc = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === '[') depth++;
    else if (ch === ']') {
      depth--;
      if (depth === 0) {
        return JSON.parse(text.slice(start, i + 1));
      }
    }
  }
  throw new Error('array JSON não fechado');
}
