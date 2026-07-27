import { createHash } from 'node:crypto';
import type { Answers } from './briefing-steps';

/**
 * Impressão digital do conteúdo do briefing — a chave da **idempotência** do
 * submit (SPEC-031 §5).
 *
 * O que ela compra: duplo clique no botão, retry de rede e reenvio do mesmo
 * formulário colidem no índice `(briefing_link_id, content_hash)` em vez de
 * gravar dois briefings. Sem isso, a pessoa que clica duas vezes cria a v1 e a
 * v2 com o mesmo conteúdo, e o prestador recebe dois cards para o mesmo
 * trabalho.
 *
 * ## Por que não `JSON.stringify(answers)` direto
 *
 * A ordem das chaves de um objeto JS segue a ordem de INSERÇÃO. As respostas
 * chegam etapa por etapa, e `mergeAnswers` reescreve a etapa inteira a cada
 * save — então preencher a etapa 2 antes da 1, ou voltar e corrigir um campo,
 * produz o mesmo conteúdo com ordem diferente. Um `stringify` ingênuo daria
 * hashes diferentes para briefings idênticos, e a idempotência morreria
 * silenciosamente: o duplo clique voltaria a criar duas versões, e ninguém
 * descobriria até ver dois cards iguais no funil.
 *
 * A serialização canônica abaixo ordena as chaves em todos os níveis, então o
 * hash depende do **conteúdo**, não do caminho que o usuário fez para chegar
 * nele.
 *
 * Arrays NÃO são ordenados de propósito: `['a','b']` e `['b','a']` são respostas
 * diferentes (a ordem em que o cliente listou funcionalidades ou referências é
 * informação dele, não ruído nosso).
 */

/**
 * JSON com chaves de objeto ordenadas recursivamente.
 *
 * `null` e escalares saem como o `JSON.stringify` faria. `undefined` some, como
 * no JSON normal — coerente com a regra de que ausência é informação (ADR-014)
 * e não vira string vazia.
 */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value) ?? 'null';
  }

  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(',')}]`;
  }

  const entries = Object.entries(value as Record<string, unknown>)
    // `undefined` não entra no JSON; deixá-lo produziria `"k":undefined`, que
    // nem é JSON válido.
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));

  return `{${entries
    .map(([key, v]) => `${JSON.stringify(key)}:${canonicalJson(v)}`)
    .join(',')}}`;
}

/**
 * Hash do conteúdo do briefing.
 *
 * SHA-256 sem salt, como o `hashToken`: não é segredo a proteger, é chave de
 * comparação. O que se quer é que conteúdo igual dê hash igual — exatamente o
 * oposto do que um salt faria.
 */
export function contentHashOf(answers: Answers): string {
  return createHash('sha256').update(canonicalJson(answers)).digest('hex');
}
