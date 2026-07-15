-- Fatia 13 — Drift de deploy (SPEC-013 v2.1): veredito + sinais persistidos no sync.
ALTER TABLE "projects" ADD COLUMN "deploy_verdict" TEXT;
ALTER TABLE "projects" ADD COLUMN "deploy_signals" JSONB;
ALTER TABLE "projects" ADD COLUMN "deploy_observed_at" TIMESTAMP(3);
