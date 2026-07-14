-- Fatia 7.7 — Invalidação de inferência por inputHash (SPEC-011, ADR-002 emendado).

-- Enum de resultado de execução de job de insight (append-only InsightRun).
CREATE TYPE "InsightRunOutcome" AS ENUM ('generated', 'reused', 'failed');

-- Rename docs_tree_sha -> docs_scope_hash (PRESERVA os valores; NÃO é drop/add).
-- Vira metadado histórico; a chave de invalidação passa a ser input_hash.
ALTER TABLE "insights" RENAME COLUMN "docs_tree_sha" TO "docs_scope_hash";

-- input_hash: a nova chave de idempotência. Nasce NULL nas linhas antigas
-- (cache-miss no 1º sync após o deploy — não reconstrói o passado, ADR-016).
ALTER TABLE "insights" ADD COLUMN "input_hash" TEXT;

-- Índice para o gate: busca por (projectId, kind, inputHash).
CREATE INDEX "insights_project_id_kind_input_hash_idx" ON "insights" ("project_id", "kind", "input_hash");

-- InsightRun: uma linha por execução de job (generated | reused | failed).
CREATE TABLE "insight_runs" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "kind" "InsightKind" NOT NULL,
    "outcome" "InsightRunOutcome" NOT NULL,
    "input_hash" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "insight_runs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "insight_runs_project_id_created_at_idx" ON "insight_runs" ("project_id", "created_at");

ALTER TABLE "insight_runs" ADD CONSTRAINT "insight_runs_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects" ("id") ON DELETE CASCADE ON UPDATE CASCADE;
