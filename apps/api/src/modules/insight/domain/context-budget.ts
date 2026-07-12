/** Documento candidato a entrar no contexto do resumo. */
export interface DocInput {
  path: string;
  content: string;
}

/** Aproximação de tokens (~4 chars/token) — suficiente para cap de custo. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/** Prioridade de inclusão (SPEC-003): README > CLAUDE > STATUS > demais. */
function priority(path: string): number {
  if (path === 'README.md') return 0;
  if (path === 'CLAUDE.md') return 1;
  if (path === 'docs/STATUS.md') return 2;
  return 3;
}

/**
 * Seleciona documentos para o contexto do resumo respeitando um teto de
 * tokens, priorizando README > CLAUDE > STATUS > demais (ordem alfabética
 * dentro do mesmo nível). Um doc que estoura o teto é truncado; os seguintes
 * que não couberem são omitidos. Nunca retorna vazio se houver ao menos um doc.
 */
export function selectContext(
  docs: DocInput[],
  maxTokens: number,
): DocInput[] {
  const ordered = [...docs].sort((a, b) => {
    const p = priority(a.path) - priority(b.path);
    return p !== 0 ? p : a.path.localeCompare(b.path);
  });

  const selected: DocInput[] = [];
  let used = 0;
  for (const doc of ordered) {
    const remaining = maxTokens - used;
    if (remaining <= 0) break;
    const cost = estimateTokens(doc.content);
    if (cost <= remaining) {
      selected.push(doc);
      used += cost;
    } else {
      // Trunca o doc para caber no que resta (útil p/ o primeiro, prioritário).
      const chars = remaining * 4;
      selected.push({
        path: doc.path,
        content: doc.content.slice(0, chars) + '\n\n[...truncado...]',
      });
      used = maxTokens;
    }
  }
  return selected;
}
