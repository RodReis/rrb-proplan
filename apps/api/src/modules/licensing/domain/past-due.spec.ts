import { cortarPorInadimplencia } from './past-due';

/**
 * O que estes testes protegem: a decisão PI #3 (`null` = nunca corta) e a
 * fronteira do dia. Os dois erram silenciosamente — um deixa o inadimplente
 * dentro para sempre, o outro corta o cliente em dia — e nenhum aparece em log.
 */
describe('cortarPorInadimplencia', () => {
  const now = new Date('2026-08-20T12:00:00.000Z');

  it('não corta licença sem atraso registrado', () => {
    expect(
      cortarPorInadimplencia({ pastDueAt: null, toleranceDays: 15, now }),
    ).toBe(false);
  });

  it('não corta enquanto o atraso está dentro da tolerância', () => {
    // Atrasou há 10 dias, tolerância 15 → ainda tem 5 dias.
    expect(
      cortarPorInadimplencia({
        pastDueAt: new Date('2026-08-10T12:00:00.000Z'),
        toleranceDays: 15,
        now,
      }),
    ).toBe(false);
  });

  it('corta quando o atraso passa da tolerância', () => {
    // Atrasou há 20 dias, tolerância 15 → passou 5 dias.
    expect(
      cortarPorInadimplencia({
        pastDueAt: new Date('2026-07-31T12:00:00.000Z'),
        toleranceDays: 15,
        now,
      }),
    ).toBe(true);
  });

  /**
   * Decisão PI #3, o caso que inverte a regra se for lido errado:
   * `toleranceDays: null` é tolerância **infinita**, não zero. Quem revoga
   * passa a ser só a plataforma.
   */
  it('NUNCA corta quando a tolerância é null, por antigo que seja o atraso', () => {
    expect(
      cortarPorInadimplencia({
        pastDueAt: new Date('2020-01-01T00:00:00.000Z'),
        toleranceDays: null,
        now,
      }),
    ).toBe(false);
  });

  /** Zero é legítimo e diferente de `null`: corta no dia seguinte ao atraso. */
  it('com tolerância zero, corta assim que o instante do atraso passa', () => {
    expect(
      cortarPorInadimplencia({
        pastDueAt: new Date('2026-08-20T11:59:59.000Z'),
        toleranceDays: 0,
        now,
      }),
    ).toBe(true);
  });

  /**
   * Fronteira exclusiva: no instante exato do vencimento o acesso ainda vale.
   * O cliente que paga no último dia precisa poder abrir o app.
   */
  it('no instante exato em que a tolerância vence, ainda não corta', () => {
    expect(
      cortarPorInadimplencia({
        pastDueAt: new Date('2026-08-05T12:00:00.000Z'), // +15d = agora, exato
        toleranceDays: 15,
        now,
      }),
    ).toBe(false);
  });

  it('um milissegundo depois do vencimento, corta', () => {
    expect(
      cortarPorInadimplencia({
        pastDueAt: new Date('2026-08-05T11:59:59.999Z'),
        toleranceDays: 15,
        now,
      }),
    ).toBe(true);
  });

  /**
   * Valor inválido no banco não derruba a base de clientes de um tenant: um
   * `-1` digitado no admin é lido como "não configurado", não como corte
   * imediato.
   */
  it('trata tolerância negativa como não configurada', () => {
    expect(
      cortarPorInadimplencia({
        pastDueAt: new Date('2020-01-01T00:00:00.000Z'),
        toleranceDays: -1,
        now,
      }),
    ).toBe(false);
  });

  it('trata NaN como não configurada', () => {
    expect(
      cortarPorInadimplencia({
        pastDueAt: new Date('2020-01-01T00:00:00.000Z'),
        toleranceDays: Number.NaN,
        now,
      }),
    ).toBe(false);
  });

  /** `now` é parâmetro: a regra não pode depender do relógio da máquina. */
  it('decide pelo `now` recebido, não pelo relógio do processo', () => {
    const pastDueAt = new Date('2026-08-01T00:00:00.000Z');
    const args = { pastDueAt, toleranceDays: 5 };

    expect(
      cortarPorInadimplencia({ ...args, now: new Date('2026-08-03T00:00:00.000Z') }),
    ).toBe(false);
    expect(
      cortarPorInadimplencia({ ...args, now: new Date('2026-08-10T00:00:00.000Z') }),
    ).toBe(true);
  });
});
