-- Fatia 14 (SPEC-019): cache de CI derivado no Project (padrão do deployVerdict).
-- Reconstruível no sync a partir da Actions API — nenhuma tabela nova.
ALTER TABLE "projects" ADD COLUMN "ci_status" TEXT;
ALTER TABLE "projects" ADD COLUMN "ci_conclusion_url" TEXT;
ALTER TABLE "projects" ADD COLUMN "ci_observed_at" TIMESTAMP(3);
