-- SPEC-031 (Fatia 20) — Briefing público: rascunho, versão imutável, catálogo.
--
-- `file_assets` (anexos) NÃO entra nesta migration: depende do ADR que decide
-- onde vive binário de cliente (spec §4). Chega na migration de anexos.

-- ---------------------------------------------------------------------------
-- Rascunho retomável: UM por link (unique em briefing_link_id).
-- ---------------------------------------------------------------------------
CREATE TABLE "briefing_drafts" (
    "id" TEXT NOT NULL,
    "briefing_link_id" TEXT NOT NULL,
    "step" INTEGER NOT NULL DEFAULT 1,
    "answers" JSONB NOT NULL DEFAULT '{}',
    "consumed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "briefing_drafts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "briefing_drafts_briefing_link_id_key"
  ON "briefing_drafts"("briefing_link_id");

ALTER TABLE "briefing_drafts" ADD CONSTRAINT "briefing_drafts_briefing_link_id_fkey"
  FOREIGN KEY ("briefing_link_id") REFERENCES "briefing_links"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Versão enviada: IMUTÁVEL. Sem coluna de atualização (nenhum `updated_at`) —
-- a ausência é intencional e é parte do contrato da spec §5.
--
-- Os dois uniques carregam regra de negócio:
--   (client_project_id, version) — sequencial POR projeto, sem buraco nem
--     duplicata quando o link é regenerado (v1 permanece, nasce v2);
--   (briefing_link_id, content_hash) — IDEMPOTÊNCIA do submit: duplo clique e
--     retry de rede colidem no índice em vez de gravar dois briefings.
-- ---------------------------------------------------------------------------
CREATE TABLE "briefing_versions" (
    "id" TEXT NOT NULL,
    "client_project_id" TEXT NOT NULL,
    "briefing_link_id" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "answers" JSONB NOT NULL,
    "content_hash" TEXT NOT NULL,
    "submitted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "briefing_versions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "briefing_versions_client_project_id_version_key"
  ON "briefing_versions"("client_project_id", "version");
CREATE UNIQUE INDEX "briefing_versions_briefing_link_id_content_hash_key"
  ON "briefing_versions"("briefing_link_id", "content_hash");
CREATE INDEX "briefing_versions_client_project_id_submitted_at_idx"
  ON "briefing_versions"("client_project_id", "submitted_at");

ALTER TABLE "briefing_versions" ADD CONSTRAINT "briefing_versions_client_project_id_fkey"
  FOREIGN KEY ("client_project_id") REFERENCES "client_projects"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "briefing_versions" ADD CONSTRAINT "briefing_versions_briefing_link_id_fkey"
  FOREIGN KEY ("briefing_link_id") REFERENCES "briefing_links"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Catálogo curado por tenant (Etapa 1). Raiz de tenancy.
-- ---------------------------------------------------------------------------
CREATE TABLE "service_catalog_items" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "segment" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "service_catalog_items_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "service_catalog_items_tenant_id_segment_label_key"
  ON "service_catalog_items"("tenant_id", "segment", "label");
CREATE INDEX "service_catalog_items_tenant_id_segment_active_idx"
  ON "service_catalog_items"("tenant_id", "segment", "active");

ALTER TABLE "service_catalog_items" ADD CONSTRAINT "service_catalog_items_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Dado de referência COMPARTILHADO (estados, cidades, segmentos).
--
-- Sem `tenant_id` e SEM RLS de propósito: é a mesma lista do Brasil para todo
-- mundo, não dado de ninguém. Vem por seed — o formulário público nunca chama
-- a API do IBGE em runtime (spec §3: IBGE fora do ar viraria briefing travado).
-- ---------------------------------------------------------------------------
CREATE TABLE "states" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "states_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "states_code_key" ON "states"("code");

CREATE TABLE "cities" (
    "id" TEXT NOT NULL,
    "state_id" TEXT NOT NULL,
    "ibge_id" INTEGER NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "cities_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "cities_ibge_id_key" ON "cities"("ibge_id");
CREATE INDEX "cities_state_id_name_idx" ON "cities"("state_id", "name");

ALTER TABLE "cities" ADD CONSTRAINT "cities_state_id_fkey"
  FOREIGN KEY ("state_id") REFERENCES "states"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "segments" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,

    CONSTRAINT "segments_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "segments_code_key" ON "segments"("code");

-- ===========================================================================
-- RLS (mesmo desenho da SPEC-029): raiz filtra por `tenant_id`, filha herda
-- por JOIN até a raiz.
--
-- FORCE: sem ele o Postgres pula a policy para o OWNER da tabela.
--
-- Fail-closed: sem `app.tenant_ids` no contexto, `NULLIF(...,'')` vira NULL,
-- `= ANY(NULL)` é NULL, e a policy não devolve linha nenhuma.
--
-- `states`/`cities`/`segments` ficam DE FORA: dado de referência público, sem
-- dono. Ligar RLS nelas sem contexto de tenant deixaria o formulário público
-- sem lista de cidades.
-- ===========================================================================

-- Raiz.
ALTER TABLE "service_catalog_items" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "service_catalog_items" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "service_catalog_items"
  USING ("tenant_id" = ANY (NULLIF(current_setting('app.tenant_ids', true), '')::text[]));

-- Bisneta: briefing_drafts → briefing_links → client_projects → clients.
ALTER TABLE "briefing_drafts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "briefing_drafts" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "briefing_drafts"
  USING ("briefing_link_id" IN (
    SELECT bl.id FROM briefing_links bl
    JOIN client_projects cp ON cp.id = bl.client_project_id
    JOIN clients c ON c.id = cp.client_id
    WHERE c.tenant_id = ANY (NULLIF(current_setting('app.tenant_ids', true), '')::text[])
  ));

-- Neta: briefing_versions → client_projects → clients.
ALTER TABLE "briefing_versions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "briefing_versions" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "briefing_versions"
  USING ("client_project_id" IN (
    SELECT cp.id FROM client_projects cp
    JOIN clients c ON c.id = cp.client_id
    WHERE c.tenant_id = ANY (NULLIF(current_setting('app.tenant_ids', true), '')::text[])
  ));

-- Grants para `proplan_app`: NÃO vão aqui — o `scripts/bootstrap-app-role.mjs`
-- já roda `ALTER DEFAULT PRIVILEGES`, que cobre tabelas criadas depois.
