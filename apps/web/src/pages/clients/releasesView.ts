import type { LicReleaseView } from '../../lib/api';

/**
 * Apresentação das releases (SPEC-041).
 *
 * Fora do componente pelo motivo de sempre nesta casa: o que decide o que a tela
 * **afirma** deve ser testável sem montar React.
 */

/** 64 dígitos hex — a mesma forma que o servidor e o CHECK do banco exigem. */
const SHA256 = /^[0-9a-f]{64}$/i;

/**
 * O `sha256` está bem formado?
 *
 * **Validar aqui não substitui o servidor** — ele revalida, e é ele quem manda.
 * O ponto é *quando o operador descobre*: um hash torto aceito pela tela só
 * apareceria como erro depois do POST, e um hash torto aceito pelos dois só
 * apareceria na máquina do cliente, depois de 80 MB baixados, como "download
 * corrompido".
 */
export function isSha256Valido(valor: string): boolean {
  return SHA256.test(valor.trim());
}

/**
 * O formulário pode ser enviado?
 *
 * Todos os campos menos `notes`, que é opcional por contrato. `releasedAt` entra
 * porque **é informado, nunca `now()`**: registrar uma release antiga com a data
 * de hoje a tornaria indevidamente autorizada para quem já tem a janela vencida.
 */
export function podeRegistrar(form: {
  productId: string;
  version: string;
  os: string;
  releasedAt: string;
  assetId: string;
  sha256: string;
}): boolean {
  return (
    form.productId.trim() !== '' &&
    form.version.trim() !== '' &&
    form.os.trim() !== '' &&
    form.releasedAt.trim() !== '' &&
    form.assetId.trim() !== '' &&
    isSha256Valido(form.sha256)
  );
}

/**
 * Rótulo do estado. **"Despublicada" não é "apagada"**, e o texto tem de dizer
 * isso: a linha continua, o artefato continua no GitHub, e o que mudou é que ela
 * sumiu do `check` e do `download`.
 */
export function publishedLabel(release: LicReleaseView): string {
  return release.published ? 'Publicada' : 'Despublicada';
}

export function publishedTone(release: LicReleaseView): 'ok' | 'muted' {
  return release.published ? 'ok' : 'muted';
}

/**
 * Hash abreviado para caber na lista. **Nunca abrevia sem o título completo** no
 * elemento — conferir hash é justamente comparar caractere a caractere, e uma
 * tela que só mostra 12 deles torna a conferência impossível.
 */
export function shortSha(sha: string): string {
  return sha.length <= 12 ? sha : `${sha.slice(0, 12)}…`;
}

/**
 * Ordena por data, mais nova primeiro — a mesma ordem do servidor.
 *
 * Existe apesar de o `findMany` já ordenar: a lista é remontada em memória
 * depois de publicar/despublicar (a resposta traz só a linha alterada), e sem
 * isto a release mexida saltaria para o fim.
 */
export function ordenarPorData(releases: readonly LicReleaseView[]): LicReleaseView[] {
  return [...releases].sort(
    (a, b) => new Date(b.releasedAt).getTime() - new Date(a.releasedAt).getTime(),
  );
}

/**
 * A data civil no formato do `<input type="date">` (`YYYY-MM-DD`).
 *
 * Existe para **preencher o formulário de edição** com o dia que está gravado.
 * Lê em UTC pela mesma razão do `shortCivilDate` (FIX #228): `releasedAt` nasce
 * de um `<input type="date">` como meia-noite UTC e a hora não significa nada —
 * convertida ao fuso local, volta um dia atrás em fuso negativo. Aqui o erro
 * seria pior que na exibição: abrir a edição de uma release, salvar sem tocar na
 * data e **gravar o dia anterior** — a tela alterando sozinha o campo que decide
 * quem tem direito à atualização.
 */
export function paraInputDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const mes = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dia = String(d.getUTCDate()).padStart(2, '0');
  return `${d.getUTCFullYear()}-${mes}-${dia}`;
}

/**
 * Só os campos que **mudaram**, para o `PATCH` (FIX #242).
 *
 * O servidor trata ausente como "não tocar" e `notes: ''` como "limpar". Mandar
 * o formulário inteiro funcionaria, mas faria toda edição reescrever todos os
 * campos — e um `sha256` reenviado igual dispararia conferência desnecessária no
 * GitHub. Mandar só o diferente é o que torna "corrigi o id do asset" uma
 * operação sobre o id do asset.
 *
 * `notes` compara contra `null` normalizado: a linha guarda `null` quando vazia,
 * o formulário guarda `''`, e sem normalizar toda abertura de formulário
 * pareceria uma alteração da nota.
 */
export function camposAlterados(
  form: { releasedAt: string; assetId: string; sha256: string; notes: string },
  original: LicReleaseView,
): { releasedAt?: string; assetId?: string; sha256?: string; notes?: string } {
  const mudou: { releasedAt?: string; assetId?: string; sha256?: string; notes?: string } = {};

  if (form.releasedAt !== paraInputDate(original.releasedAt)) {
    mudou.releasedAt = new Date(form.releasedAt).toISOString();
  }
  if (form.assetId.trim() !== original.assetId) mudou.assetId = form.assetId.trim();
  if (form.sha256.trim().toLowerCase() !== original.sha256) {
    mudou.sha256 = form.sha256.trim();
  }
  if (form.notes.trim() !== (original.notes ?? '')) mudou.notes = form.notes.trim();

  return mudou;
}

/**
 * Tolera `#Titulo` sem espaço depois do `#`.
 *
 * As notas são **coladas** da Release do GitHub, e a cópia perde o espaço com
 * facilidade — foi o que aconteceu com a `1.0.1` do War Room, cujas seções
 * (`## Vida da sala`, `## Portas`, `## Correções`) chegaram como `#Vida da
 * sala`. Por CommonMark isso não é heading, então o changelog inteiro virava uma
 * lista chapada: **as correções deixavam de se distinguir das novidades**, que é
 * justamente o que se procura ao ler notas de versão.
 *
 * Normaliza na exibição e **não toca no que está gravado** (ADR-014: o ProPlan se
 * adapta ao que existe, nunca reescreve o texto do dono). Quem editar as notas
 * continua vendo exatamente o que digitou.
 *
 * Só age no início da linha e só até 6 `#` — é a forma do heading. Um `#` no meio
 * de uma frase (`corrigido #242`) não é tocado, e `#hashtag` no começo de linha
 * viraria heading pelo mesmo critério que o CommonMark usaria se houvesse o
 * espaço: aqui o texto é changelog, onde linha começando com `#` é seção.
 */
export function normalizarHeadings(markdown: string): string {
  // `(?!#)` fecha a sequência de `#` antes do lookahead: sem ele, `#{1,6}`
  // casaria só o primeiro `#` de `## Portas` e o `(?=\S)` veria o segundo como
  // "texto colado", produzindo `# # Portas` — quebrando o heading que já estava
  // certo. E `#######Sete` (7 `#`, que não é heading em CommonMark) ficaria
  // `###### #Sete`, inventando um heading onde não havia.
  return markdown.replace(/^(#{1,6})(?!#)(?=\S)/gm, '$1 ');
}
