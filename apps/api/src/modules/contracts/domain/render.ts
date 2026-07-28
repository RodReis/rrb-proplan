/**
 * Renderização do contrato: template + snapshot → HTML (SPEC-034 §2.4, §2.5,
 * §2.12). Regra pura — sem Prisma, sem HTTP, sem Nest.
 *
 * ## Substituição escapada, nunca avaliação
 *
 * O valor entra **escapado** e o `{{nome}}` some. Nunca uma engine que avalie
 * expressão: o template é texto que o dono edita, e uma engine o transformaria
 * em execução de código a partir de dado que, mais adiante na cadeia, veio do
 * **cliente** pelo briefing. Um cliente chamado `<script>alert(1)</script>`
 * precisa aparecer como texto na página pública (§5, critério literal).
 *
 * ## A ordem importa, e é a parte que erra sem aparecer
 *
 * 1. **Escapa o corpo do template inteiro** — inclusive o que o dono digitou.
 * 2. **Substitui os placeholders**, escapando cada valor no ato (§`substitute`).
 * 3. **Só então** converte a marcação (`#`, `##`, `**`) em tags.
 *
 * Escapar o corpo e o valor em passos separados — em vez de escapar tudo junto
 * depois da substituição — é o que impede o valor de ser reescapado: um cliente
 * `Bar & Cia` viraria `Bar &amp;amp; Cia` na tela, porque o `&amp;` gerado
 * seria escapado uma segunda vez.
 *
 * Converter a marcação por último é o que garante que as ÚNICAS tags do
 * documento nasceram aqui: qualquer `<` vindo do template ou de um valor já
 * virou `&lt;` antes, e não há caminho em que ele volte a ser tag.
 *
 * ## Markdown mínimo, escrito à mão em vez de biblioteca
 *
 * O subconjunto usado pelos templates é `#`, `##`, `**negrito**`, listas `-` e
 * parágrafos — nada mais. Uma biblioteca de markdown aceita HTML embutido por
 * padrão, e desligar isso corretamente é mais superfície de configuração do que
 * o conversor inteiro daqui. Numa página que serve dado pessoal sem
 * autenticação, a superfície menor ganha.
 */

import type { ContractPlaceholder } from './placeholders';

/**
 * Os valores que substituem os placeholders. Todos já em texto final.
 *
 * Um `Record` chaveado pela lista do PR-2 — e não uma interface com os doze
 * campos escritos à mão — para que acrescentar um placeholder lá quebre aqui
 * até alguém decidir de onde ele sai. Duas listas divergiriam em silêncio, e o
 * placeholder novo apareceria vazio no contrato do cliente.
 */
export type RenderValues = Record<ContractPlaceholder, string>;

/**
 * Disclaimer do §2.12 — vai no **documento renderizado**, não só na tela de
 * edição do template. É o que viaja junto do que o cliente lê, que é o lugar
 * certo: quem recebe o link não passa pela tela de edição.
 */
export const CONTRACT_DISCLAIMER =
  'Este documento foi gerado a partir de um modelo editável pelo prestador e ' +
  'não passou por revisão jurídica. Recomenda-se a revisão por advogado antes ' +
  'da assinatura.';

/** `& < > " '` → entidades. A base de tudo que vem depois. */
export function escapeHtml(texto: string): string {
  return texto
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Aceita `{{ nome }}` com espaços em volta — digitação natural (PR-2). */
const PLACEHOLDER_RE = /\{\{\s*([a-z_]+)\s*\}\}/g;

/**
 * Troca os `{{nome}}` do corpo já escapado pelo valor, **escapando o valor
 * aqui dentro**.
 *
 * O escape do valor acontece nesta função, e não antes de chamá-la, porque quem
 * a chama monta os valores a partir de fontes diversas (perfil, cliente,
 * escopo, estimativa) e um caminho que esquecesse de escapar produziria uma
 * página pública com `<script>` executável. Escapar no ponto único por onde
 * **todo** valor passa é o que torna esse esquecimento impossível.
 *
 * `escapeText` é a exceção nominal: `{{scope}}` chega como marcação (`- item`,
 * `**título**`) montada pelo `scopeToMarkup` a partir de itens **já escapados**
 * um a um. Reescapar o bloco inteiro transformaria os `**` em texto literal.
 *
 * Placeholder sem valor vira string vazia, e não o literal cru: o desconhecido
 * já foi recusado ao salvar (§2.4), então o que chega aqui sem valor é campo
 * opcional em branco — e `{{payment_terms}}` aparecendo cru no contrato do
 * cliente é pior que uma linha vazia.
 */
export function substitute(
  corpoEscapado: string,
  values: RenderValues,
  jaEscapados: ReadonlySet<string> = new Set(),
): string {
  return corpoEscapado.replace(PLACEHOLDER_RE, (_, nome: string) => {
    const valor = values[nome as ContractPlaceholder] ?? '';
    return jaEscapados.has(nome) ? valor : escapeText(valor);
  });
}

/**
 * Escape de **valor**: entidades HTML + neutralização da marcação.
 *
 * O `escapeHtml` sozinho não bastaria. Ele não toca em `*`, e a conversão de
 * marcação roda **depois** da substituição — então um cliente cujo nome
 * contivesse `**` teria metade do contrato em negrito, e um valor iniciado por
 * `# ` viraria título. Não é falha de segurança (nenhuma tag nova nasce daí),
 * é o documento saindo diferente do que o dono escreveu, por causa de texto que
 * ele não digitou.
 *
 * Quem marca é o **template**; valor é conteúdo, e conteúdo não formata.
 */
function escapeText(valor: string): string {
  return escapeHtml(valor).replace(/[*#_-]/g, (c) => `&#${c.charCodeAt(0)};`);
}

/**
 * Placeholders cujo valor **já vem escapado** e carrega marcação própria.
 *
 * Lista de nomes, não padrão genérico: cada entrada é uma decisão de deixar
 * marcação passar para a página pública, e afrouxar isso deixaria a próxima
 * entrar sem ninguém decidir — mesmo desenho da exceção de `provider-profile`
 * na guarda de imutabilidade.
 */
export const MARKUP_PLACEHOLDERS: ReadonlySet<string> = new Set(['scope']);

/**
 * Marcação → HTML. Roda por ÚLTIMO, sobre texto onde todo `<` já é `&lt;`.
 *
 * Suporta o que os templates usam: `# título`, `## seção`, `- item`,
 * `**negrito**` e parágrafos separados por linha em branco.
 */
export function markupToHtml(texto: string): string {
  const blocos = texto.split(/\n\s*\n/);
  const partes: string[] = [];

  for (const bruto of blocos) {
    const bloco = bruto.trim();
    if (bloco === '') continue;

    const linhas = bloco.split('\n').map((l) => l.trim());

    // Lista: o bloco inteiro começa com `-` na primeira linha.
    if (linhas[0].startsWith('- ')) {
      const itens = linhas
        .filter((l) => l.startsWith('- '))
        .map((l) => `<li>${inline(l.slice(2))}</li>`)
        .join('');
      partes.push(`<ul>${itens}</ul>`);
      continue;
    }

    if (bloco.startsWith('## ')) {
      partes.push(`<h2>${inline(bloco.slice(3).trim())}</h2>`);
      continue;
    }
    if (bloco.startsWith('# ')) {
      partes.push(`<h1>${inline(bloco.slice(2).trim())}</h1>`);
      continue;
    }

    // Parágrafo: quebra simples dentro do bloco vira espaço, como no markdown.
    partes.push(`<p>${inline(linhas.join(' '))}</p>`);
  }

  return partes.join('\n');
}

/** `**negrito**` dentro de uma linha. Nada mais — nem link, nem imagem. */
function inline(texto: string): string {
  return texto.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
}

/**
 * O documento completo: corpo renderizado + disclaimer no rodapé.
 *
 * O `renderedHtml` é **gravado**, não recalculado na leitura (PR-1): renderizar
 * de novo a cada acesso permitiria que uma mudança neste arquivo alterasse,
 * meses depois, um documento que o cliente já leu.
 */
export function renderContract(body: string, values: RenderValues): string {
  const corpo = markupToHtml(
    substitute(escapeHtml(body), values, MARKUP_PLACEHOLDERS),
  );
  return [
    '<article class="contract">',
    corpo,
    '</article>',
    `<footer class="contract-disclaimer"><p>${escapeHtml(CONTRACT_DISCLAIMER)}</p></footer>`,
  ].join('\n');
}
