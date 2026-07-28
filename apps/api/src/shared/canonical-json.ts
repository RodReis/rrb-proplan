/**
 * Serialização JSON canônica — chaves de objeto ordenadas recursivamente.
 *
 * Vive em `shared/` porque **dois módulos dependem da mesma regra**: o
 * `briefing` a usa no `contentHash` do envio (SPEC-031 §5) e o `artifacts` no
 * `inputHash` do pipeline (SPEC-032 §2.8). Duplicar as 18 linhas criaria duas
 * verdades sobre a mesma pergunta — *"estes dois conteúdos são o mesmo?"* — e
 * uma correção aplicada num lado só reapareceria como bug de idempotência no
 * outro, silenciosamente. Importar `briefing/domain/**` a partir do `artifacts`
 * violaria o ADR-001, então a promoção para cá é o caminho que respeita as
 * duas coisas.
 *
 * ## Por que não `JSON.stringify` direto
 *
 * A ordem das chaves de um objeto JS segue a ordem de INSERÇÃO. No briefing as
 * respostas chegam etapa por etapa; no pipeline o insumo é montado a partir
 * delas. Preencher a etapa 2 antes da 1, ou voltar e corrigir um campo, produz
 * o mesmo conteúdo com ordem diferente — e um `stringify` ingênuo daria hashes
 * diferentes para entradas idênticas. A idempotência morreria em silêncio: o
 * duplo clique voltaria a criar duas versões, o job rodando duas vezes voltaria
 * a gerar artefato duplicado, e ninguém descobriria até ver a duplicata.
 *
 * Arrays NÃO são ordenados, de propósito: `['a','b']` e `['b','a']` são
 * respostas diferentes. A ordem em que o cliente listou funcionalidades ou
 * referências é informação dele, não ruído nosso.
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
