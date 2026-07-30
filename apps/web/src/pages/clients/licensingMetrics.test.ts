import { describe, expect, it } from 'vitest';
import {
  alturasRelativas,
  preencherDias,
  salesLabel,
  salesState,
  sourceRows,
} from './licensingMetrics';

describe('SPEC-040: zero é resultado, ausência é outra coisa', () => {
  it('distingue "nunca vendeu" de "nenhuma venda no período"', () => {
    // Os dois renderizariam "0" numa tela ingênua. Quem ainda não vendeu leria
    // o painel como QUEDA; quem teve um mês fraco, como se o produto não
    // existisse. São fatos diferentes e a tela precisa dizer qual é qual.
    expect(salesState({ everSold: false, sales: { approved: 0 } })).toBe('nunca');
    expect(salesState({ everSold: true, sales: { approved: 0 } })).toBe('zero');
    expect(salesState({ everSold: true, sales: { approved: 3 } })).toBe('com-vendas');
  });

  it('os três estados têm textos diferentes, e o do período nomeia a janela', () => {
    expect(salesLabel('nunca', '30')).toBe('Nenhuma venda registrada ainda');
    expect(salesLabel('zero', '7')).toBe('Nenhuma venda em 7 dias');
    expect(salesLabel('zero', 'current_month')).toBe('Nenhuma venda em mês atual');
    expect(salesLabel('com-vendas', '30')).toBe('Vendas no período');
  });

  it('"nunca vendeu" não depende do período — o sinal vem de fora da janela', () => {
    // `everSold` responde "já houve alguma vez". Se a tela o derivasse da
    // contagem da janela, todo mês sem venda viraria "nunca vendeu".
    for (const period of ['7', '30', '90', 'current_month'] as const) {
      expect(salesState({ everSold: false, sales: { approved: 0 } })).toBe('nunca');
      expect(salesLabel('nunca', period)).toBe('Nenhuma venda registrada ainda');
    }
  });
});

describe('SPEC-040: o gráfico não mente por compressão', () => {
  it('preenche os dias sem ativação com zero', () => {
    // Sem isto, ativações em 01, 03 e 05 apareceriam como três barras vizinhas
    // — sugerindo três dias SEGUIDOS de atividade.
    const contagens = preencherDias(
      [
        { day: '2026-08-01', count: 2 },
        { day: '2026-08-03', count: 1 },
      ],
      '2026-08-01',
      '2026-08-04',
    );

    expect(contagens).toEqual([
      { day: '2026-08-01', count: 2 },
      { day: '2026-08-02', count: 0 },
      { day: '2026-08-03', count: 1 },
      { day: '2026-08-04', count: 0 },
    ]);
  });

  it('atravessa a virada de mês e a de ano', () => {
    expect(preencherDias([], '2026-07-30', '2026-08-01').map((d) => d.day)).toEqual([
      '2026-07-30',
      '2026-07-31',
      '2026-08-01',
    ]);
    expect(preencherDias([], '2026-12-31', '2027-01-01').map((d) => d.day)).toEqual([
      '2026-12-31',
      '2027-01-01',
    ]);
  });

  it('NÃO reconverte o dia com fuso — a string já é o dia de São Paulo', () => {
    // O servidor resolve o dia em BRT e manda `YYYY-MM-DD`. Aplicar o
    // deslocamento de novo aqui moveria a barra um dia para trás — o mesmo erro
    // cometido duas vezes, que é o jeito de ele passar despercebido.
    const um = preencherDias([{ day: '2026-08-15', count: 5 }], '2026-08-15', '2026-08-15');
    expect(um).toEqual([{ day: '2026-08-15', count: 5 }]);
  });

  it('janela invertida devolve vazio, não trava', () => {
    expect(preencherDias([], '2026-08-10', '2026-08-01')).toEqual([]);
  });

  it('escala pelo maior valor, não por um teto inventado', () => {
    // Um teto fixo faria um pico de 3 parecer irrelevante num painel calibrado
    // para 100 — e 3 é a ordem de grandeza do piloto.
    expect(alturasRelativas([{ day: 'd', count: 1 }, { day: 'e', count: 3 }])).toEqual([
      1 / 3,
      1,
    ]);
  });

  it('tudo zero devolve tudo zero, nunca NaN', () => {
    // Dividir por zero pintaria a régua inteira de barras cheias, afirmando
    // atividade que não houve.
    const alturas = alturasRelativas([
      { day: 'd', count: 0 },
      { day: 'e', count: 0 },
    ]);
    expect(alturas).toEqual([0, 0]);
    expect(alturas.some(Number.isNaN)).toBe(false);
  });

  it('lista vazia não quebra', () => {
    expect(alturasRelativas([])).toEqual([]);
  });
});

describe('SPEC-040: acesso ao source no painel', () => {
  it('NONE não aparece — é o estado de quem não vende código-fonte', () => {
    // Exibi-lo faria o bloco dizer "247 sem acesso" sobre licenças que nunca
    // deveriam ter acesso nenhum, e o número grande roubaria a atenção dos
    // três estados que pedem gente.
    const linhas = sourceRows({ NONE: 247, ACTIVE: 4, FAILED: 1 });
    expect(linhas.map((l) => l.key)).toEqual(['FAILED', 'ACTIVE']);
  });

  it('estado com zero não aparece', () => {
    expect(sourceRows({ ACTIVE: 2 }).map((l) => l.key)).toEqual(['ACTIVE']);
  });

  it('os que pedem gente vêm primeiro', () => {
    // A ordem é de urgência, não alfabética nem a do enum: FAILED, PENDING e
    // INVITED são os três estados em que alguém está esperando.
    const linhas = sourceRows({ ACTIVE: 9, REMOVED: 2, PENDING: 1, FAILED: 1, INVITED: 3 });
    expect(linhas.map((l) => l.key)).toEqual([
      'FAILED',
      'PENDING',
      'INVITED',
      'ACTIVE',
      'REMOVED',
    ]);
    expect(linhas.filter((l) => l.urgente).map((l) => l.key)).toEqual([
      'FAILED',
      'PENDING',
      'INVITED',
    ]);
  });

  it('estado desconhecido do servidor é ignorado, não quebra a tela', () => {
    // Se o enum ganhar um valor e a tela não souber dele, o bloco continua
    // renderizando o que conhece — em vez de mostrar `undefined`.
    expect(sourceRows({ ESTADO_NOVO: 5 })).toEqual([]);
  });
});
