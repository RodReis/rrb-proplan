-- Liga LlmUsage ao artefato Insight que a chamada gerou (SPEC-011): o painel de
-- Atividade casa InsightRun ↔ LlmUsage por (project_id, kind, input_hash) para
-- mostrar tokens/custo por linha de IA. Nullable, aditivo — sem risco.
ALTER TABLE "llm_usage" ADD COLUMN "input_hash" TEXT;

CREATE INDEX "llm_usage_project_id_kind_input_hash_idx" ON "llm_usage" ("project_id", "kind", "input_hash");
