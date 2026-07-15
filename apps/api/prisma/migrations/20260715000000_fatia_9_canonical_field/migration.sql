-- Fatia 9 — Modelo canônico (SPEC-014): store reconstruível por (projeto, entidade, campo).
CREATE TABLE "canonical_fields" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "field" TEXT NOT NULL,
    "value" JSONB,
    "provenance_class" TEXT NOT NULL,
    "provenance_ref" JSONB NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "confidence_math" JSONB NOT NULL,
    "docs_scope_hash" TEXT NOT NULL,
    "resolved_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "canonical_fields_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "canonical_fields_project_id_entity_field_key" ON "canonical_fields"("project_id", "entity", "field");

ALTER TABLE "canonical_fields" ADD CONSTRAINT "canonical_fields_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Limiar de recusa do modelo canônico (SPEC-014, decisão 4 do PI): padrão 0.4.
ALTER TABLE "settings" ADD COLUMN "canonical_refusal_threshold" DOUBLE PRECISION NOT NULL DEFAULT 0.4;
