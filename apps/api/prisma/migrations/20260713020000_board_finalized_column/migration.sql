-- Fatia 5 (emenda 2026-07-13): 6ª coluna Finalizado (SPEC-005).
-- Feito = closed sem label (aguardando aceite); Finalizado = closed +
-- proplan:finalizado (aceito pelo PI).

-- AlterEnum
ALTER TYPE "BoardColumn" ADD VALUE 'finalized';
