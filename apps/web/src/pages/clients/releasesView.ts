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
