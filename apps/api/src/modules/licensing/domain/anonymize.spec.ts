import { CAMPOS_DE_CONCILIACAO, redigirPayload } from './anonymize';

/**
 * Um payload da Kiwify como ele chega — com os campos de conciliação e os
 * pessoais misturados, que é o formato real (fixtures da SPEC-038).
 */
const PAYLOAD_KIWIFY = {
  order_id: 'a1b2c3',
  order_ref: 'REF-9931',
  order_status: 'paid',
  webhook_event_type: 'order_approved',
  created_at: '2026-07-20T10:00:00Z',
  Customer: {
    full_name: 'Ana Silva',
    email: 'ana@exemplo.com',
    mobile: '+5511999999999',
    CPF: '123.456.789-00',
  },
  Commissions: { charge_amount: 49700, currency: 'BRL' },
  Product: { product_id: 'prod-1', product_name: 'War Room' },
};

describe('SPEC-040: redação do payload na exclusão a pedido', () => {
  it('preserva os campos de conciliação', () => {
    // O que sobra tem de responder "esta venda existiu, com este id, neste
    // dia" — é o que permite conferir na plataforma sem dizer quem comprou.
    const limpo = redigirPayload(PAYLOAD_KIWIFY);

    expect(limpo).toEqual({
      order_id: 'a1b2c3',
      order_ref: 'REF-9931',
      order_status: 'paid',
      webhook_event_type: 'order_approved',
      created_at: '2026-07-20T10:00:00Z',
    });
  });

  it('descarta os campos pessoais, inclusive aninhados', () => {
    // O `Customer` inteiro some. Ele é um objeto, e uma redação que só olhasse
    // o primeiro nível de chaves o deixaria passar inteiro.
    const serializado = JSON.stringify(redigirPayload(PAYLOAD_KIWIFY));

    expect(serializado).not.toContain('ana@exemplo.com');
    expect(serializado).not.toContain('Ana Silva');
    expect(serializado).not.toContain('123.456.789-00');
    expect(serializado).not.toContain('+5511999999999');
  });

  it('descarta campo pessoal DESCONHECIDO — a razão de ser allowlist', () => {
    // Este é o teste que justifica a decisão. Uma denylist apagaria os campos
    // que conhecemos hoje; no dia em que a plataforma acrescentar um campo
    // novo — ou em que o adapter da Hotmart entrar —, ele sobreviveria à
    // anonimização **em silêncio**: o titular pediu a exclusão, o ProPlan
    // respondeu que fez, e o dado continuou no banco.
    const comCampoNovo = {
      ...PAYLOAD_KIWIFY,
      buyer_document_number: '987.654.321-00',
      customer_birth_date: '1990-03-15',
    };

    const serializado = JSON.stringify(redigirPayload(comCampoNovo));
    expect(serializado).not.toContain('987.654.321-00');
    expect(serializado).not.toContain('1990-03-15');
  });

  it('descarta o preço, e é deliberado', () => {
    // O preço é o único dado do payload que a §Métricas manda não usar para
    // número nenhum — o link para a plataforma é o caminho, e é lá que ele
    // continua existindo. Preservá-lo aqui seria guardar, num registro que o
    // titular pediu para limpar, o dado cuja autoridade a fatia declara ser de
    // outro sistema.
    const limpo = redigirPayload(PAYLOAD_KIWIFY);
    expect(JSON.stringify(limpo)).not.toContain('49700');
    expect(limpo).not.toHaveProperty('Commissions');
  });

  it('preserva campo de conciliação vazio, sem inventar ausência', () => {
    // `in` e não truthy: `order_status: ''` é um fato que a plataforma mandou.
    expect(redigirPayload({ order_id: 'x', order_status: '' })).toEqual({
      order_id: 'x',
      order_status: '',
    });
  });

  it('payload que não é objeto vira objeto vazio', () => {
    // A coluna é `Json` e quem escreve é a plataforma: array, string e null
    // são valores possíveis. Devolver o original deixaria passar o que quer
    // que ele fosse.
    expect(redigirPayload(null)).toEqual({});
    expect(redigirPayload('texto solto')).toEqual({});
    expect(redigirPayload([{ email: 'ana@exemplo.com' }])).toEqual({});
    expect(redigirPayload(undefined)).toEqual({});
  });

  it('a allowlist não contém nenhum campo de pessoa', () => {
    // Prova por ausência, no mesmo desenho das provas de receita da
    // SPEC-034/035: acrescentar `Customer` a esta lista um dia seria uma linha
    // inocente, e um vazamento na anonimização.
    const suspeitos = ['customer', 'email', 'name', 'cpf', 'document', 'phone', 'mobile'];
    for (const campo of CAMPOS_DE_CONCILIACAO) {
      expect(suspeitos.some((s) => campo.toLowerCase().includes(s))).toBe(false);
    }
  });
});
