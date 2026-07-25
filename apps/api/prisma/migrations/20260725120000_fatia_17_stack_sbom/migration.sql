-- SPEC-023 (Fatia 17): stack detectada via SBOM do Dependency Graph.
-- Cache do sync, no mesmo molde de deploy_* (SPEC-013) e ci_* (SPEC-019):
-- a aba lê daqui, nunca chama o GitHub no render (ADR-002).
--
-- stack_enabled é NULLABLE de propósito e os três estados são distintos:
--   NULL  = nunca coletado (projeto anterior a esta fatia, sync não rodou)
--   false = Dependency Graph desabilitado/vazio → fallback informativo
--   true  = detectado, ver stack_ecosystems / stack_packages
-- Colapsar NULL em false faria "ainda não sincronizado" se passar por
-- "não habilitado neste repo" — os dois têm ações diferentes para o usuário.
ALTER TABLE "projects" ADD COLUMN "stack_enabled" BOOLEAN;
ALTER TABLE "projects" ADD COLUMN "stack_ecosystems" JSONB;
ALTER TABLE "projects" ADD COLUMN "stack_packages" JSONB;
ALTER TABLE "projects" ADD COLUMN "stack_source_sha" TEXT;
ALTER TABLE "projects" ADD COLUMN "stack_observed_at" TIMESTAMP(3);
