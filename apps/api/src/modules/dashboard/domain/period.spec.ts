import { PERIODS, isPeriod, periodStart } from './period';

/**
 * A regra do §2.9: **agregação no fuso `America/Sao_Paulo`, armazenamento em
 * UTC**. O critério de aceite nomeia o caso que dói: linha criada às 22 h de
 * 31/07 (BRT) conta em julho, não em agosto — porque em UTC ela é 01 h de 01/08.
 */
describe('dashboard: período (SPEC-035 §2.8, §2.9)', () => {
  // Referência fixa: 15/08/2026, 12:00 BRT = 15:00 UTC. Sem `Date.now()` no
  // teste — o corte tem de ser reproduzível em qualquer dia do ano.
  const AGORA = new Date('2026-08-15T15:00:00.000Z');

  describe('a lista fechada de períodos', () => {
    it('são exatamente os 4 da spec — nenhum 5º entra sem decisão do PI', () => {
      expect(PERIODS).toEqual(['7', '30', '90', 'current_month']);
    });

    it('isPeriod aceita os 4 e recusa o resto', () => {
      for (const p of PERIODS) expect(isPeriod(p)).toBe(true);
      expect(isPeriod('60')).toBe(false);
      expect(isPeriod('')).toBe(false);
      expect(isPeriod('last_month')).toBe(false);
      // Número fora da lista é o caso que a rota RECUSA (§6): corrigir em
      // silêncio para o padrão faria erro de front virar dado errado em tela.
      expect(isPeriod('365')).toBe(false);
    });
  });

  describe('janelas de N dias', () => {
    it('7 dias volta 7 dias corridos a partir de agora', () => {
      expect(periodStart('7', AGORA).toISOString()).toBe('2026-08-08T15:00:00.000Z');
    });

    it('30 e 90 seguem a mesma contagem corrida', () => {
      expect(periodStart('30', AGORA).toISOString()).toBe('2026-07-16T15:00:00.000Z');
      expect(periodStart('90', AGORA).toISOString()).toBe('2026-05-17T15:00:00.000Z');
    });
  });

  describe('mês corrente vira no fuso de São Paulo, não em UTC', () => {
    it('o começo do mês é 00:00 BRT, que em UTC é 03:00 do dia 1º', () => {
      // BRT é UTC-3 o ano inteiro desde 2019 (sem horário de verão).
      expect(periodStart('current_month', AGORA).toISOString()).toBe(
        '2026-08-01T03:00:00.000Z',
      );
    });

    it('às 22 h de 31/07 BRT o mês corrente ainda é JULHO — o caso do §5', () => {
      // 31/07 22:00 BRT = 01/08 01:00 UTC. Quem agrega em UTC diria "agosto"
      // e a contagem de julho perderia a linha no último dia do mês — erro que
      // só aparece ao fechar o mês, quando ninguém está mais olhando o código.
      const virada = new Date('2026-08-01T01:00:00.000Z');
      expect(periodStart('current_month', virada).toISOString()).toBe(
        '2026-07-01T03:00:00.000Z',
      );
    });

    it('às 00:30 de 01/08 BRT já é AGOSTO', () => {
      const depois = new Date('2026-08-01T03:30:00.000Z');
      expect(periodStart('current_month', depois).toISOString()).toBe(
        '2026-08-01T03:00:00.000Z',
      );
    });

    it('a virada de ano funciona: 31/12 22 h BRT ainda é dezembro', () => {
      const reveillon = new Date('2027-01-01T01:00:00.000Z');
      expect(periodStart('current_month', reveillon).toISOString()).toBe(
        '2026-12-01T03:00:00.000Z',
      );
    });
  });
});
