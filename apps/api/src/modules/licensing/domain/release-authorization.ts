/**
 * A autorização de update, isolada como função pura (SPEC-041 §Escopo item 5).
 *
 * ## A regra
 *
 * Uma release está autorizada quando `updatesUntil >= release.releasedAt`.
 *
 * ## Por que o `updatesUntil` é o DA LICENÇA, nunca o da edição
 *
 * A spec é explícita e o motivo é comercial, não técnico: `LicEdition.updatesMonths`
 * é a *política vigente* do catálogo, e ela muda. `License.updatesUntil` é o que
 * **aquele comprador** levou, copiado na emissão (é o mesmo desenho do
 * `maxMachines` e do `billingModel`). Ler a política da edição aqui faria uma
 * mudança de preço de hoje **encurtar a janela de quem comprou ano passado** — a
 * licença perpétua deixaria de ser perpétua por efeito colateral de uma edição de
 * catálogo, e ninguém perceberia até um cliente reclamar que perdeu acesso a um
 * update que já tinha.
 *
 * Esta função nem recebe a edição, de propósito: o parâmetro que não existe não
 * pode ser lido por engano.
 *
 * ## `>=`, não `>`
 *
 * Release publicada exatamente no instante em que a janela vence **está**
 * autorizada. O contrário puniria o cliente por um empate de timestamp, e a
 * fronteira do que ele comprou é o próprio `updatesUntil` — inclusive.
 */

/** O mínimo que a decisão precisa saber sobre uma release. */
export interface AuthorizableRelease {
  version: string;
  releasedAt: Date;
}

/**
 * A mais nova release **autorizada** para esta licença, ou `null` se nenhuma.
 *
 * **Devolve a última autorizada, não "nada", quando a janela venceu** — é o
 * critério de aceite que prova a promessa da licença perpétua: quem parou de
 * pagar update continua baixando o que já tinha direito, e só deixa de receber o
 * que veio depois. Responder `null` aí faria o cliente perder também o que já
 * era dele (e é por isso que o artefato nunca é apagado, decisão 3 do PI).
 *
 * A entrada **não precisa vir ordenada**: ordenar aqui é uma linha, e depender da
 * ordem do `findMany` faria a corretude desta função morar no `orderBy` de outro
 * arquivo.
 */
export function latestAuthorized<T extends AuthorizableRelease>(
  releases: readonly T[],
  updatesUntil: Date,
): T | null {
  const autorizadas = releases.filter(
    (r) => r.releasedAt.getTime() <= updatesUntil.getTime(),
  );
  if (autorizadas.length === 0) return null;

  return autorizadas.reduce((maisNova, r) =>
    r.releasedAt.getTime() > maisNova.releasedAt.getTime() ? r : maisNova,
  );
}

/**
 * A release mais nova **existente** (autorizada ou não), para decidir o `reason`.
 *
 * O cliente precisa distinguir *"você está na última"* de *"há uma mais nova que
 * sua janela não cobre"*: no segundo caso o War Room pode oferecer a renovação, e
 * sem essa distinção ele só saberia dizer "atualizado", que seria mentira.
 */
export function latestOverall<T extends AuthorizableRelease>(
  releases: readonly T[],
): T | null {
  if (releases.length === 0) return null;

  return releases.reduce((maisNova, r) =>
    r.releasedAt.getTime() > maisNova.releasedAt.getTime() ? r : maisNova,
  );
}
