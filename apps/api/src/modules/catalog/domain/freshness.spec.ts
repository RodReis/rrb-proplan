import { computeFreshness } from './freshness';

const day = (n: number) => new Date(2026, 0, n);

describe('computeFreshness', () => {
  it('stale quando código está à frente dos docs além do limiar', () => {
    // docs em 1/jan, código em 1/abr (~90 dias), limiar 30
    const r = computeFreshness(day(1), new Date(2026, 3, 1), 30);
    expect(r.stale).toBe(true);
  });

  it('não stale quando o gap está dentro do limiar', () => {
    const r = computeFreshness(day(1), day(10), 30); // 9 dias
    expect(r.stale).toBe(false);
  });

  it('não stale quando docs são mais recentes que o código', () => {
    const r = computeFreshness(day(20), day(1), 30);
    expect(r.stale).toBe(false);
  });

  it('limiar 0 desliga o alerta mesmo com gap enorme', () => {
    const r = computeFreshness(day(1), new Date(2028, 0, 1), 0);
    expect(r.stale).toBe(false);
  });

  it('datas nulas → não stale (sem documentação / falha de coleta)', () => {
    expect(computeFreshness(null, day(10), 90).stale).toBe(false);
    expect(computeFreshness(day(1), null, 90).stale).toBe(false);
    expect(computeFreshness(null, null, 90).stale).toBe(false);
  });

  it('gap exatamente no limiar não é stale (só acima)', () => {
    const r = computeFreshness(day(1), day(31), 30); // exatamente 30 dias
    expect(r.stale).toBe(false);
  });

  it('devolve as datas e o limiar inalterados', () => {
    const d = day(1);
    const c = day(10);
    const r = computeFreshness(d, c, 45);
    expect(r).toEqual({
      lastDocsCommitAt: d,
      lastCodeCommitAt: c,
      thresholdDays: 45,
      stale: false,
    });
  });
});
