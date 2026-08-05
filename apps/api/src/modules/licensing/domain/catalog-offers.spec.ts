import {
  ofertasNuncaVendidas,
  type MapeamentoDoTenant,
  type OfertaDoCatalogo,
} from './catalog-offers';

/**
 * O bloco 3 da aba *Oferta → edição* (SPEC-047).
 *
 * O que se testa aqui não é formatação: é **o que a tela oferece**. Oferecer uma
 * oferta já coberta manda o operador cadastrar algo que o servidor recusa por
 * unique; repeti-la num segundo bloco desfaz a separação que a SPEC-046 acabou
 * de fazer; e deixar de oferecer uma que ninguém mapeou é o bug que abriu a
 * fatia — a primeira compra falha com o dinheiro do cliente no meio.
 */
function oferta(over: Partial<OfertaDoCatalogo> = {}): OfertaDoCatalogo {
  return {
    externalProductId: 'prod-1',
    productName: 'War Room',
    externalOfferId: 'of-1',
    offerName: 'Sem código Fonte',
    ...over,
  };
}

function mapeamento(over: Partial<MapeamentoDoTenant> = {}): MapeamentoDoTenant {
  return { externalProductId: 'prod-1', externalOfferId: 'of-1', ...over };
}

describe('ofertasNuncaVendidas', () => {
  it('catálogo vazio não oferece nada', () => {
    expect(ofertasNuncaVendidas([], [], [])).toEqual([]);
  });

  it('oferta do catálogo sem de-para e sem venda vira linha', () => {
    const r = ofertasNuncaVendidas([oferta()], [], []);

    expect(r).toEqual([
      {
        externalProductId: 'prod-1',
        productName: 'War Room',
        externalOfferId: 'of-1',
        offerName: 'Sem código Fonte',
      },
    ]);
  });

  it('mapeamento exato tira a oferta da lista', () => {
    expect(ofertasNuncaVendidas([oferta()], [mapeamento()], [])).toEqual([]);
  });

  /**
   * O curinga do produto resolve **qualquer** oferta dele. Sem esta regra a tela
   * ofereceria mapear de novo um produto que já resolve, e o servidor recusaria
   * por unique — beco criado pela própria tela.
   */
  it('curinga do produto cobre todas as ofertas dele', () => {
    const catalogo = [
      oferta({ externalOfferId: 'of-1' }),
      oferta({ externalOfferId: 'of-2', offerName: 'Com Código Fonte' }),
    ];

    const r = ofertasNuncaVendidas(catalogo, [mapeamento({ externalOfferId: null })], []);

    expect(r).toEqual([]);
  });

  it('curinga de OUTRO produto não cobre este', () => {
    const r = ofertasNuncaVendidas(
      [oferta()],
      [mapeamento({ externalProductId: 'prod-outro', externalOfferId: null })],
      [],
    );

    expect(r).toHaveLength(1);
  });

  /**
   * *Uma oferta nunca sai em dois blocos* — invariante da SPEC-046, estendida ao
   * terceiro. A oferta que já vendeu tem a própria linha nos blocos 1/2, com
   * ocorrências e falhas; repeti-la aqui diria duas coisas sobre o mesmo fato.
   */
  it('oferta já presente nos blocos 1 ou 2 NÃO repete no 3', () => {
    const r = ofertasNuncaVendidas(
      [oferta()],
      [],
      [{ externalProductId: 'prod-1', externalOfferId: 'of-1' }],
    );

    expect(r).toEqual([]);
  });

  it('outra oferta do mesmo produto continua saindo, mesmo com a irmã já vista', () => {
    const catalogo = [
      oferta({ externalOfferId: 'of-1' }),
      oferta({ externalOfferId: 'of-2', offerName: 'Com Código Fonte' }),
    ];

    const r = ofertasNuncaVendidas(catalogo, [], [
      { externalProductId: 'prod-1', externalOfferId: 'of-1' },
    ]);

    expect(r).toHaveLength(1);
    expect(r[0].externalOfferId).toBe('of-2');
  });

  /**
   * **Produto ativo com `offers: []`** — a doc oficial da Kiwify mostra esse
   * caso com `price: 500`, um produto que vende sem oferta nenhuma no array. A
   * spec afirmava que `externalOfferId` é "nunca nulo"; tratá-lo assim deixaria
   * o produto invisível, que é o bug que a fatia veio matar. Decisão do PI:
   * entra como curinga do produto.
   */
  it('produto sem ofertas entra como linha de curinga (offerId nulo)', () => {
    const r = ofertasNuncaVendidas(
      [oferta({ externalOfferId: null, offerName: null })],
      [],
      [],
    );

    expect(r).toHaveLength(1);
    expect(r[0].externalOfferId).toBeNull();
    expect(r[0].productName).toBe('War Room');
  });

  it('curinga já mapeado tira também a linha do produto sem ofertas', () => {
    const r = ofertasNuncaVendidas(
      [oferta({ externalOfferId: null, offerName: null })],
      [mapeamento({ externalOfferId: null })],
      [],
    );

    expect(r).toEqual([]);
  });

  /**
   * O `null` do curinga não pode colidir com um produto cujo id de oferta fosse
   * a string "null" — mesma chave do `seen-offers.ts`.
   */
  it('oferta com id literal "null" não colide com o curinga', () => {
    const r = ofertasNuncaVendidas(
      [oferta({ externalOfferId: 'null', offerName: 'Estranha' })],
      [mapeamento({ externalProductId: 'prod-outro', externalOfferId: null })],
      [],
    );

    expect(r).toHaveLength(1);
    expect(r[0].externalOfferId).toBe('null');
  });

  /**
   * O catálogo é externo: um id repetido no payload deles produziria duas linhas
   * idênticas com o mesmo botão *Mapear*, e a segunda falharia por unique.
   */
  it('par repetido no catálogo vira uma linha só', () => {
    const r = ofertasNuncaVendidas([oferta(), oferta()], [], []);

    expect(r).toHaveLength(1);
  });

  /**
   * Alfabética, não por "gravidade": nenhuma destas linhas tem dinheiro parado,
   * e o que o operador precisa é **encontrar** a oferta que acabou de criar.
   */
  it('ordena por nome do produto, depois pelo nome da oferta', () => {
    const catalogo = [
      oferta({ externalProductId: 'p2', productName: 'Zebra', externalOfferId: 'z1' }),
      oferta({
        externalProductId: 'p1',
        productName: 'Alfa',
        externalOfferId: 'a2',
        offerName: 'Segunda',
      }),
      oferta({
        externalProductId: 'p1',
        productName: 'Alfa',
        externalOfferId: 'a1',
        offerName: 'Primeira',
      }),
    ];

    const r = ofertasNuncaVendidas(catalogo, [], []);

    expect(r.map((o) => o.externalOfferId)).toEqual(['a1', 'a2', 'z1']);
  });
});
