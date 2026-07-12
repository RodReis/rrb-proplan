import { DocInput } from './context-budget';

const TODAY_PLACEHOLDER = '{{DATA}}';

export const BOOTSTRAP_SYSTEM = `Você gera um arquivo STATUS.md para um projeto de software, no formato exato da convenção abaixo. Responda SOMENTE com o conteúdo markdown do arquivo — sem cercas de código, sem comentários, sem texto antes ou depois.

Formato obrigatório:

---
proplan: v1
updated: ${TODAY_PLACEHOLDER}
---
# Status

## Backlog
- <itens futuros, um por linha; pode ficar vazio>

## A Fazer
- <itens planejados>

## Em Andamento
- <itens em curso>

## Feito
- <itens concluídos>

Regras:
- As quatro seções (Backlog, A Fazer, Em Andamento, Feito) são OBRIGATÓRIAS, mesmo que vazias.
- Cada card é um item de lista começando com "- ".
- Metadados opcionais entre parênteses ao fim do card: "(prio: alta)", "(desde: AAAA-MM-DD)", "(em: AAAA-MM-DD)".
- Infira as colunas a partir da documentação fornecida. Não invente funcionalidades que a documentação não menciona.
- Escreva em português (pt-BR).`;

/** Monta o prompt de bootstrap com a data e os docs de contexto. */
export function buildBootstrapUser(docs: DocInput[], today: string): string {
  const body = docs
    .map((d) => `### Arquivo: ${d.path}\n\n${d.content}`)
    .join('\n\n---\n\n');
  return `Data de hoje: ${today}\n\nDocumentação do projeto:\n\n${body}`;
}

export { TODAY_PLACEHOLDER };
