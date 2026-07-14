/**
 * Contrato da convenção: nomes de exibição das 6 colunas do board (CONVENTION.md).
 *
 * Kernel compartilhado — só o contrato, sem lógica. O "todo → A Fazer" não é do
 * board: é da convenção, e tem vários consumidores (board, projeção .proplan/
 * STATUS.md, painel de Atividade, futuro MCP). Uma fonte só, aqui — renomear uma
 * coluna é um único edit, e ninguém mente em silêncio (ADR-017 aplicado internamente).
 *
 * As chaves são os valores canônicos de coluna (o enum `BoardColumn` do board).
 * Não importamos o tipo daqui para não inverter a fronteira DDD (ADR-001): o board
 * é dono do mapeamento issue↔coluna; o kernel só carrega o nome legível.
 */
export const COLUMN_TITLE: Record<string, string> = {
  backlog: 'Backlog',
  todo: 'A Fazer',
  doing: 'Em Andamento',
  done: 'Feito',
  finalized: 'Finalizado',
  discarded: 'Descartado',
};

/** Nome de exibição de uma coluna, com fallback ao valor cru se desconhecido. */
export function columnTitle(column: string): string {
  return COLUMN_TITLE[column] ?? column;
}
