import { DocInput } from './context-budget';

export const SUMMARY_SYSTEM = `Você é um analista técnico. Recebe a documentação de um projeto de software e resume seu estado para alguém que vai retomá-lo.

Responda SOMENTE com um objeto JSON válido, sem cercas de código, sem texto antes ou depois, no formato exato:
{"oQueE": string, "ondeParou": string, "oQueFalta": string[]}

- oQueE: o que o projeto é, em 1-2 frases.
- ondeParou: o estado atual / última coisa concluída, em 1-2 frases.
- oQueFalta: lista curta (3-6 itens) do que ainda falta, cada item uma frase.

Escreva em português (pt-BR). Baseie-se apenas na documentação fornecida; não invente fatos.`;

/** Monta o conteúdo do usuário concatenando os docs selecionados. */
export function buildSummaryUser(docs: DocInput[]): string {
  return docs
    .map((d) => `### Arquivo: ${d.path}\n\n${d.content}`)
    .join('\n\n---\n\n');
}
