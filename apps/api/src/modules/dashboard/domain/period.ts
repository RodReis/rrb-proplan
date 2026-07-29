/**
 * O período das contagens do dashboard (SPEC-035 §2.8, §2.9).
 *
 * **Lista fechada, padrão 30.** Valor fora dela é recusado pela rota, nunca
 * corrigido em silêncio para o padrão (§6): corrigir caladamente faria um erro
 * de front virar dado errado em tela, e o número apareceria plausível.
 *
 * O período afeta **só** os blocos de contagem. *Esperando você* é estado
 * corrente, não janela — não passa por aqui.
 */
export const PERIODS = ['7', '30', '90', 'current_month'] as const;

export type Period = (typeof PERIODS)[number];

export const DEFAULT_PERIOD: Period = '30';

export function isPeriod(valor: string): valor is Period {
  return (PERIODS as readonly string[]).includes(valor);
}

/**
 * Offset de São Paulo em relação a UTC, em horas.
 *
 * Constante porque o Brasil **não tem horário de verão desde 2019** (Decreto
 * 9.772/2019). Se voltar, este é o ponto único a mudar — e o teste de virada de
 * mês falha antes de a contagem mentir, que é o comportamento desejado.
 */
const SAO_PAULO_UTC_OFFSET_HOURS = -3;

const MS_POR_DIA = 24 * 60 * 60 * 1000;
const MS_POR_HORA = 60 * 60 * 1000;

/**
 * Início da janela do período, em UTC — pronto para ir num `gte` do Prisma.
 *
 * **`armazenamento em UTC, agregação em BRT`** (§2.9). Para `current_month` isso
 * importa de verdade: uma linha criada às 22 h de 31/07 em São Paulo é 01 h de
 * 01/08 em UTC. Cortar o mês em UTC jogaria essa linha para agosto e julho
 * perderia o próprio último dia — erro que só aparece ao fechar o mês, quando
 * ninguém está mais olhando o código que o causou.
 */
export function periodStart(period: Period, agora: Date): Date {
  if (period === 'current_month') {
    // Desloca para o "relógio de São Paulo", lê ano/mês desse relógio, e devolve
    // o instante UTC correspondente a 00:00 BRT do dia 1º.
    const emSaoPaulo = new Date(agora.getTime() + SAO_PAULO_UTC_OFFSET_HOURS * MS_POR_HORA);
    const inicioLocal = Date.UTC(
      emSaoPaulo.getUTCFullYear(),
      emSaoPaulo.getUTCMonth(),
      1,
      0,
      0,
      0,
      0,
    );
    return new Date(inicioLocal - SAO_PAULO_UTC_OFFSET_HOURS * MS_POR_HORA);
  }

  return new Date(agora.getTime() - Number(period) * MS_POR_DIA);
}
