/**
 * As ofertas do **catálogo da plataforma** que ainda não venderam e não têm
 * de-para (SPEC-047, bloco 3 da aba *Oferta → edição*).
 *
 * ## A pergunta que este arquivo responde, e por que ela é nova
 *
 * `seen-offers.ts` responde *"o que já apareceu numa entrega e não tem de-para"*
 * — por construção, ele só enxerga oferta que **já vendeu**. A oferta criada na
 * Kiwify ontem, ainda sem venda, é invisível para ele: a primeira compra dela é
 * o primeiro aviso, e o aviso é uma entrega `FAILED` com o dinheiro do cliente
 * no meio. Foi exatamente o que aconteceu no dogfooding de 2026-08-04.
 *
 * Aqui a fonte é outra: o retrato do catálogo (`LicCatalogSnapshot`), lido da
 * API pública. O cruzamento com os mapeamentos é o mesmo — e é **derivado na
 * leitura**, nunca persistido. O snapshot guarda o que a Kiwify disse; a
 * conclusão *"esta oferta está descoberta"* nasce aqui, a cada leitura, e por
 * isso nunca desatualiza: mapear a oferta a remove da lista sem job nenhum, e
 * remover o de-para a traz de volta.
 *
 * ## Função pura, fora do serviço — mesmo corte do `seen-offers.ts`
 *
 * O que decide **quais ofertas a tela oferece** é regra de leitura. Testá-la no
 * serviço exigiria banco e HTTP; aqui ela recebe as listas e devolve o que falta.
 */

/** Uma oferta do catálogo, reduzida ao que esta regra precisa. */
export interface OfertaDoCatalogo {
  externalProductId: string;
  productName: string;
  /**
   * `null` quando o produto **não tem ofertas** no catálogo.
   *
   * A SPEC-047 afirmava que este campo é *"nunca nulo: a API lista ofertas
   * concretas"*. A doc oficial da Kiwify desmente: o exemplo de
   * `GET /v1/products/{id}` traz `"offers": []` num produto **ativo com
   * `price: 500`** — produto que vende com o preço nele mesmo, sem oferta
   * nenhuma no array.
   *
   * Tratá-lo como "sem oferta, logo fora da lista" deixaria justamente esse
   * produto invisível — o bug que esta fatia veio matar. Então ele entra como
   * **curinga do produto**, que é o que o `LicOfferMapping` já modela
   * (`externalOfferId: null` = qualquer oferta daquele produto) e o que
   * `seen-offers.ts` já sabe casar. Decisão do PI, 2026-08-04.
   */
  externalOfferId: string | null;
  offerName: string | null;
}

/** Um mapeamento já cadastrado — o que faz uma oferta sair da lista. */
export interface MapeamentoDoTenant {
  externalProductId: string;
  externalOfferId: string | null;
}

/** Uma oferta do catálogo que ninguém comprou e ninguém mapeou. */
export interface OfertaNuncaVendida {
  externalProductId: string;
  productName: string;
  externalOfferId: string | null;
  /** `null` quando a linha é o produto inteiro (ver {@link OfertaDoCatalogo}). */
  offerName: string | null;
}

/**
 * As ofertas do catálogo **sem cobertura e sem venda**.
 *
 * Três exclusões, e cada uma responde a um critério de aceite da spec:
 *
 * 1. **Coberta** — existe mapeamento exato **ou** curinga do produto. Mesma
 *    regra de casamento do `seen-offers.ts`, e pelo mesmo motivo: sem ela a tela
 *    ofereceria mapear de novo um produto que já resolve, e o servidor recusaria
 *    com violação de unique — um beco criado pela própria tela.
 * 2. **Já vista** — a oferta aparece nos blocos 1 ou 2. *Uma oferta nunca sai em
 *    dois blocos* é invariante da SPEC-046, e esta fatia a estende ao terceiro.
 * 3. **Inativa** — filtrada antes, por quem monta a lista de entrada: não há
 *    compra futura a proteger numa oferta que ninguém pode comprar.
 *
 * A ordem é a do catálogo — nome do produto, depois nome da oferta. Aqui não há
 * urgência a ordenar: nenhuma destas linhas tem dinheiro parado, e ordenar por
 * "gravidade" inventaria uma hierarquia que não existe. Alfabética é o que
 * permite ao operador **encontrar** a oferta que ele acabou de criar.
 */
export function ofertasNuncaVendidas(
  catalogo: OfertaDoCatalogo[],
  mapeamentos: MapeamentoDoTenant[],
  /** Os pares que já saem nos blocos 1 e 2 (`seen-offers.ts`). */
  jaVistas: ReadonlyArray<{ externalProductId: string; externalOfferId: string | null }>,
): OfertaNuncaVendida[] {
  const curingas = new Set(
    mapeamentos.filter((m) => m.externalOfferId === null).map((m) => m.externalProductId),
  );
  const exatos = new Set(
    mapeamentos
      .filter((m) => m.externalOfferId !== null)
      .map((m) => chave(m.externalProductId, m.externalOfferId)),
  );
  const vistas = new Set(
    jaVistas.map((v) => chave(v.externalProductId, v.externalOfferId)),
  );

  const linhas: OfertaNuncaVendida[] = [];
  // Duas ofertas com o mesmo par não podem virar duas linhas: o catálogo é
  // externo, e um id repetido no payload deles produziria duas linhas idênticas
  // com o mesmo botão *Mapear* — a segunda falharia por unique.
  const emitidas = new Set<string>();

  for (const oferta of catalogo) {
    const k = chave(oferta.externalProductId, oferta.externalOfferId);

    if (curingas.has(oferta.externalProductId)) continue;
    if (oferta.externalOfferId !== null && exatos.has(k)) continue;
    if (vistas.has(k)) continue;
    if (emitidas.has(k)) continue;

    emitidas.add(k);
    linhas.push({
      externalProductId: oferta.externalProductId,
      productName: oferta.productName,
      externalOfferId: oferta.externalOfferId,
      offerName: oferta.offerName,
    });
  }

  return linhas.sort(
    (a, b) =>
      a.productName.localeCompare(b.productName, 'pt-BR') ||
      (a.offerName ?? '').localeCompare(b.offerName ?? '', 'pt-BR'),
  );
}

/** `null` de oferta vira marcador próprio: um produto cujo id fosse a string
 *  "null" não pode colidir com o curinga. Mesma chave do `seen-offers.ts`. */
function chave(produto: string, oferta: string | null): string {
  return `${produto} ${oferta ?? ' curinga'}`;
}
