import { DEFAULT_PERIOD, PERIODS, isPeriod, periodStart } from './period';

/**
 * O período das métricas de licenciamento (SPEC-040 §Métricas).
 *
 * Mesmas regras do dashboard (SPEC-035 §2.8, §2.9), em arquivo próprio porque
 * `licensing` é frente disjunta e a arch-spec varre importação de outro módulo
 * — ver o cabeçalho do `period.ts`. Os testes são duplicados **de propósito**:
 * se um dos dois arquivos mudar sozinho, é aqui que aparece.
 */
describe('licensing: período das métricas (SPEC-040)', () => {
  // Referência fixa: 15/08/2026, 12:00 BRT = 15:00 UTC. Sem `Date.now()` — o
  // corte tem de ser reproduzível em qualquer dia do ano.
  const AGORA = new Date('2026-08-15T15:00:00.000Z');

  describe('a lista fechada', () => {
    it('são exatamente os 4 — nenhum 5º entra sem decisão do PI', () => {
      expect(PERIODS).toEqual(['7', '30', '90', 'current_month']);
      expect(DEFAULT_PERIOD).toBe('30');
    });

    it('isPeriod aceita os 4 e recusa o resto', () => {
      for (const p of PERIODS) expect(isPeriod(p)).toBe(true);
      // Cada um destes é um jeito de a rota receber algo que "parece" período.
      // Todos são RECUSADOS: corrigir em silêncio para o padrão faria a tela
      // mostrar a contagem de uma janela que ninguém pediu.
      expect(isPeriod('60')).toBe(false);
      expect(isPeriod('365')).toBe(false);
      expect(isPeriod('')).toBe(false);
      expect(isPeriod('last_month')).toBe(false);
      expect(isPeriod('CURRENT_MONTH')).toBe(false);
    });
  });

  describe('janelas de N dias', () => {
    it('7, 30 e 90 são dias corridos a partir de agora', () => {
      expect(periodStart('7', AGORA).toISOString()).toBe('2026-08-08T15:00:00.000Z');
      expect(periodStart('30', AGORA).toISOString()).toBe('2026-07-16T15:00:00.000Z');
      expect(periodStart('90', AGORA).toISOString()).toBe('2026-05-17T15:00:00.000Z');
    });
  });

  describe('o mês vira em São Paulo, não em UTC', () => {
    it('o começo do mês é 00:00 BRT = 03:00 UTC do dia 1º', () => {
      expect(periodStart('current_month', AGORA).toISOString()).toBe(
        '2026-08-01T03:00:00.000Z',
      );
    });

    it('VIRADA DE MÊS: 22 h de 31/07 BRT ainda conta em julho', () => {
      // 31/07 22:00 BRT = 01/08 01:00 UTC. Uma venda nesse instante, agregada
      // em UTC, cairia em agosto — e julho perderia o próprio último dia. É o
      // erro que só aparece ao fechar o mês, quando ninguém está mais olhando.
      const virada = new Date('2026-08-01T01:00:00.000Z');
      expect(periodStart('current_month', virada).toISOString()).toBe(
        '2026-07-01T03:00:00.000Z',
      );
    });

    it('às 00:30 de 01/08 BRT já é agosto', () => {
      const depois = new Date('2026-08-01T03:30:00.000Z');
      expect(periodStart('current_month', depois).toISOString()).toBe(
        '2026-08-01T03:00:00.000Z',
      );
    });

    it('VIRADA DE ANO: 22 h de 31/12 BRT ainda conta em dezembro', () => {
      // O mesmo erro do mês, com o ano junto: agregado em UTC, um réveillon às
      // 22 h viraria janeiro do ano seguinte — e o fechamento do ano perderia
      // as vendas do último dia.
      const reveillon = new Date('2027-01-01T01:00:00.000Z');
      expect(periodStart('current_month', reveillon).toISOString()).toBe(
        '2026-12-01T03:00:00.000Z',
      );
    });

    it('às 00:30 de 01/01 BRT já é o ano novo', () => {
      const anoNovo = new Date('2027-01-01T03:30:00.000Z');
      expect(periodStart('current_month', anoNovo).toISOString()).toBe(
        '2027-01-01T03:00:00.000Z',
      );
    });
  });
});
