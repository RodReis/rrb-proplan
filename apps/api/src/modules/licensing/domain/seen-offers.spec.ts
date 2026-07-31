import {
  ofertasNaoMapeadas,
  type EventoParaOferta,
  type MapeamentoExistente,
} from './seen-offers';

/**
 * As ofertas oferecidas para mapeamento (FIX do dogfooding, 2026-07-31).
 *
 * O que se testa aqui não é formatação: é **o que a tela oferece**. Oferecer uma
 * oferta já coberta manda o operador cadastrar algo que o servidor vai recusar
 * por unique — um beco criado pela própria tela. Deixar de oferecer uma que
 * falhou mantém a venda parada.
 */
function evento(over: Partial<EventoParaOferta> = {}): EventoParaOferta {
  return {
    externalProductId: 'prod-1',
    externalOfferId: null,
    receivedAt: new Date('2026-07-30T12:00:00Z'),
    status: 'FAILED',
    ...over,
  };
}

function mapeamento(over: Partial<MapeamentoExistente> = {}): MapeamentoExistente {
  return { externalProductId: 'prod-1', externalOfferId: null, ...over };
}

describe('ofertasNaoMapeadas', () => {
  it('sem entrega nenhuma, não oferece nada', () => {
    expect(ofertasNaoMapeadas([], [])).toEqual([]);
  });

  it('oferta vista e sem mapeamento vira linha', () => {
    const r = ofertasNaoMapeadas([evento()], []);

    expect(r).toHaveLength(1);
    expect(r[0].externalProductId).toBe('prod-1');
    expect(r[0].falhas).toBe(1);
  });

  it('agrupa entregas repetidas do mesmo par', () => {
    // Três vendas do mesmo produto falharam: é UMA linha para mapear, não três.
    const r = ofertasNaoMapeadas(
      [evento(), evento(), evento({ status: 'PROCESSED' })],
      [],
    );

    expect(r).toHaveLength(1);
    expect(r[0].ocorrencias).toBe(3);
    expect(r[0].falhas).toBe(2);
  });

  it('guarda a entrega mais recente do par', () => {
    const r = ofertasNaoMapeadas(
      [
        evento({ receivedAt: new Date('2026-07-28T12:00:00Z') }),
        evento({ receivedAt: new Date('2026-07-31T09:00:00Z') }),
      ],
      [],
    );

    expect(r[0].ultimaEm.toISOString()).toBe('2026-07-31T09:00:00.000Z');
  });

  it('evento SEM produto no payload não vira linha', () => {
    // Não haveria o que mapear, e a linha vazia mandaria o operador procurar um
    // dado que não existe.
    const r = ofertasNaoMapeadas([evento({ externalProductId: undefined })], []);

    expect(r).toEqual([]);
  });

  describe('o que já está coberto sai da lista', () => {
    it('mapeamento EXATO cobre a oferta', () => {
      const r = ofertasNaoMapeadas(
        [evento({ externalOfferId: 'of-1' })],
        [mapeamento({ externalOfferId: 'of-1' })],
      );

      expect(r).toEqual([]);
    });

    it('CURINGA do produto cobre qualquer oferta dele', () => {
      // `externalOfferId: null` resolve todas as ofertas do produto. Oferecer
      // mapear de novo faria o servidor recusar por unique.
      const r = ofertasNaoMapeadas(
        [
          evento({ externalOfferId: 'of-1' }),
          evento({ externalOfferId: 'of-2' }),
          evento({ externalOfferId: null }),
        ],
        [mapeamento({ externalOfferId: null })],
      );

      expect(r).toEqual([]);
    });

    it('mapeamento exato NÃO cobre outra oferta do mesmo produto', () => {
      const r = ofertasNaoMapeadas(
        [evento({ externalOfferId: 'of-2' })],
        [mapeamento({ externalOfferId: 'of-1' })],
      );

      expect(r).toHaveLength(1);
      expect(r[0].externalOfferId).toBe('of-2');
    });

    it('mapeamento de OUTRO produto não cobre nada aqui', () => {
      const r = ofertasNaoMapeadas(
        [evento({ externalProductId: 'prod-2' })],
        [mapeamento({ externalProductId: 'prod-1' })],
      );

      expect(r).toHaveLength(1);
      expect(r[0].externalProductId).toBe('prod-2');
    });
  });

  describe('ordem: o que custa mais caro primeiro', () => {
    it('mais falhas vem antes', () => {
      const r = ofertasNaoMapeadas(
        [
          evento({ externalProductId: 'poucas', status: 'PROCESSED' }),
          evento({ externalProductId: 'muitas' }),
          evento({ externalProductId: 'muitas' }),
        ],
        [],
      );

      expect(r.map((o) => o.externalProductId)).toEqual(['muitas', 'poucas']);
    });

    it('empatado em falhas, a entrega mais recente vem antes', () => {
      const r = ofertasNaoMapeadas(
        [
          evento({
            externalProductId: 'antigo',
            receivedAt: new Date('2026-07-20T12:00:00Z'),
          }),
          evento({
            externalProductId: 'novo',
            receivedAt: new Date('2026-07-31T12:00:00Z'),
          }),
        ],
        [],
      );

      expect(r.map((o) => o.externalProductId)).toEqual(['novo', 'antigo']);
    });
  });

  it('produto chamado "null" não colide com o curinga', () => {
    // A chave interna precisa distinguir o texto "null" da ausência de oferta.
    const r = ofertasNaoMapeadas(
      [evento({ externalProductId: 'p', externalOfferId: 'null' })],
      [mapeamento({ externalProductId: 'p', externalOfferId: null })],
    );

    // Coberto pelo curinga do produto `p` — e não por confusão de string.
    expect(r).toEqual([]);
  });
});
