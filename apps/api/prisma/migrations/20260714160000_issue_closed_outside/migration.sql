-- Issue fechada fora do fluxo do ProPlan (closed sem label proplan:*) — cai em
-- Finalizado com badge "fechada fora do ProPlan" (SPEC-005 linha 119). Aditivo.
ALTER TABLE "issues" ADD COLUMN "closed_outside" BOOLEAN NOT NULL DEFAULT false;
