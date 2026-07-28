/**
 * Placeholders de template de contrato (SPEC-034 §2.4). Regra pura — sem
 * Prisma, sem HTTP, sem Nest.
 *
 * ## Substituição, nunca avaliação
 *
 * A renderização (PR-3) troca `{{nome}}` pelo valor **escapado**. Nunca uma
 * engine que avalie expressão: um template é texto que o dono do workspace
 * edita, e uma engine transformaria esse texto em execução de código a partir
 * de dado que, mais adiante na cadeia, veio do cliente pelo briefing.
 *
 * ## Por que a validação é ao SALVAR, e não ao renderizar
 *
 * Placeholder desconhecido descoberto na renderização já é tarde: ou vaza como
 * literal cru no meio de uma cláusula do documento que o cliente lê, ou derruba
 * a emissão com o texto jurídico já escrito em cima dele. Recusar ao salvar
 * devolve o erro a quem pode consertá-lo, na tela em que ele está — e com o
 * nome do placeholder na mensagem, senão a pessoa procura num texto de 2.400
 * caracteres qual dos `{{...}}` está errado.
 */

import { CONTRACT_PLACEHOLDERS } from '../../../../prisma/contract-templates.seed';

export { CONTRACT_PLACEHOLDERS };
export type ContractPlaceholder = (typeof CONTRACT_PLACEHOLDERS)[number];

const CONHECIDOS: ReadonlySet<string> = new Set(CONTRACT_PLACEHOLDERS);

/**
 * Captura `{{ qualquer coisa }}` — inclusive o malformado.
 *
 * Deliberadamente permissivo: se casasse só com o que é bem formado
 * (`\{\{\w+\}\}`), um `{{client name}}` com espaço no meio **não seria
 * encontrado** e passaria pela validação intocado, para reaparecer como literal
 * cru no contrato. O que a validação não vê, ela aprova.
 */
const PLACEHOLDER_RE = /\{\{([^{}]*)\}\}/g;

export interface PlaceholderIssue {
  /** O conteúdo bruto entre as chaves, como escrito no template. */
  raw: string;
  reason: 'desconhecido' | 'malformado';
}

/** Todos os placeholders do corpo, na ordem, com repetição. */
export function extractPlaceholders(body: string): string[] {
  return [...body.matchAll(PLACEHOLDER_RE)].map((m) => m[1]);
}

/**
 * O que há de errado no corpo. Lista vazia = pode salvar.
 *
 * Devolve **todos** os problemas, não o primeiro: corrigir um por vez, com um
 * `PATCH` e um recarregamento a cada volta, é o que faz alguém desistir e colar
 * o texto de volta sem os placeholders.
 */
export function validatePlaceholders(body: string): PlaceholderIssue[] {
  const issues: PlaceholderIssue[] = [];
  const vistos = new Set<string>();

  for (const bruto of extractPlaceholders(body)) {
    if (vistos.has(bruto)) continue;
    vistos.add(bruto);

    const nome = bruto.trim();

    // `{{ client_name }}` com espaços em volta é aceito e normalizado na
    // renderização — é digitação natural e recusá-la seria rigor sem ganho.
    // Espaço NO MEIO (`{{client name}}`) é outra coisa: não existe placeholder
    // com esse nome, e tratá-lo como "desconhecido" já bastaria, mas a
    // distinção dá uma mensagem melhor para o erro mais provável de digitação.
    if (nome === '' || /\s/.test(nome)) {
      issues.push({ raw: bruto, reason: 'malformado' });
      continue;
    }

    if (!CONHECIDOS.has(nome)) {
      issues.push({ raw: bruto, reason: 'desconhecido' });
    }
  }

  return issues;
}

/** Mensagem legível, com os nomes — a pessoa precisa saber QUAL corrigir. */
export function describeIssues(issues: readonly PlaceholderIssue[]): string {
  const nomes = issues.map((i) => `{{${i.raw}}}`).join(', ');
  const conhecidos = [...CONTRACT_PLACEHOLDERS].join(', ');
  return `Placeholder não reconhecido: ${nomes}. Os aceitos são: ${conhecidos}.`;
}
