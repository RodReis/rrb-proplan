import { DocInput } from './context-budget';

export interface CardProposal {
  title: string;
  column: 'backlog' | 'todo' | 'doing' | 'done';
  priority: 'alta' | 'media' | 'baixa' | null;
}

export const CARDS_SYSTEM = `Você propõe um backlog inicial de cards de Kanban para um projeto de software, a partir da documentação. Responda SOMENTE com JSON válido no formato:

{"cards": [{"title": "...", "column": "backlog|todo|doing|done", "priority": "alta|media|baixa|null"}]}

Regras:
- Cada card é uma tarefa concreta e acionável, com título curto em português (pt-BR).
- "column" reflete o estado provável pela documentação: já feito → "done"; em curso → "doing"; planejado → "todo"; ideia futura → "backlog".
- "priority" é opcional (use null quando não der para inferir).
- NÃO invente funcionalidades que a documentação não menciona.
- Máximo 20 cards. Sem texto fora do JSON.`;

export function buildCardsUser(docs: DocInput[]): string {
  const body = docs
    .map((d) => `### Arquivo: ${d.path}\n\n${d.content}`)
    .join('\n\n---\n\n');
  return `Documentação do projeto:\n\n${body}`;
}

/** Valida e normaliza a resposta JSON do LLM. Lança se o formato quebrar. */
export function parseCards(text: string): CardProposal[] {
  const trimmed = text.trim().replace(/^```(?:json)?\n?|\n?```$/g, '');
  const parsed = JSON.parse(trimmed) as { cards?: unknown };
  if (!Array.isArray(parsed.cards)) {
    throw new Error('Resposta sem array "cards"');
  }
  const cols = new Set(['backlog', 'todo', 'doing', 'done']);
  const prios = new Set(['alta', 'media', 'baixa']);
  return parsed.cards.map((raw, i) => {
    const c = raw as Record<string, unknown>;
    if (typeof c.title !== 'string' || !c.title.trim()) {
      throw new Error(`Card ${i} sem título`);
    }
    const column = cols.has(c.column as string) ? (c.column as CardProposal['column']) : 'backlog';
    const priority = prios.has(c.priority as string)
      ? (c.priority as 'alta' | 'media' | 'baixa')
      : null;
    return { title: c.title.trim(), column, priority };
  });
}
