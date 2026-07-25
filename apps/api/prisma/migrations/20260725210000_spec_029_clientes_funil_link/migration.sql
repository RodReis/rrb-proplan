-- SPEC-029 (Fatia 19, MVP3) — Frente Clientes: clientes, projetos de cliente,
-- funil auditado, link público de briefing e trilha append-only.
--
-- Domínio DISJUNTO do board de repos (ADR-023): o ADR-011 segue mandando nas
-- GitHub Issues; o funil de clientes é estado do app. Nenhum fato nos dois.
--
-- `Tenant.installationId` NÃO aparece aqui: a coluna já nasceu nullable na
-- migration da Fatia 8 (`20260717214642_fatia_8_multi_tenant`, "installation_id"
-- INTEGER sem NOT NULL). O critério de aceite da spec já estava satisfeito pelo
-- schema existente — só o ADR-024 faltava, e ele não é DDL.

-- ========================================================================
-- (1) Enum do funil — 10 estados internos, mais finos que as 4 colunas da UI
-- ========================================================================

CREATE TYPE "ClientProjectState" AS ENUM (
  'DRAFT', 'LINK_SENT', 'BRIEFING_STARTED', 'BRIEFING_SUBMITTED',
  'ARTIFACTS_READY', 'CONTRACT_PENDING', 'CONTRACT_APPROVED',
  'IN_PRODUCTION', 'DELIVERED', 'ARCHIVED'
);

-- ========================================================================
-- (2) Tabelas
-- ========================================================================

-- Raiz de tenancy da frente: carrega tenant_id e tem policy própria.
CREATE TABLE "clients" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "cpf" TEXT,
    "company" TEXT,
    "cnpj" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "whatsapp" TEXT,
    "zip_code" TEXT,
    "street" TEXT,
    "district" TEXT,
    "city" TEXT,
    "state" TEXT,
    "notes" TEXT,
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "clients_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "client_projects" (
    "id" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "state" "ClientProjectState" NOT NULL DEFAULT 'DRAFT',
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "client_projects_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "client_status_transitions" (
    "id" TEXT NOT NULL,
    "client_project_id" TEXT NOT NULL,
    "from_state" "ClientProjectState" NOT NULL,
    "to_state" "ClientProjectState" NOT NULL,
    "actor_user_id" TEXT,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "client_status_transitions_pkey" PRIMARY KEY ("id")
);

-- Só o HASH do token (SHA-256). O token em claro é exibido uma única vez na
-- resposta da criação e nunca persistido — critério de aceite da SPEC-029.
CREATE TABLE "briefing_links" (
    "id" TEXT NOT NULL,
    "client_project_id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3),
    "revoked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "briefing_links_pkey" PRIMARY KEY ("id")
);

-- Append-only: só INSERT e leitura (garantido na aplicação; nenhum use case
-- da fatia emite UPDATE/DELETE aqui).
CREATE TABLE "audit_events" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "payload" JSONB,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_events_pkey" PRIMARY KEY ("id")
);

-- ========================================================================
-- (3) Índices
-- ========================================================================

CREATE INDEX "clients_tenant_id_deleted_at_idx" ON "clients"("tenant_id", "deleted_at");
CREATE INDEX "client_projects_client_id_deleted_at_idx" ON "client_projects"("client_id", "deleted_at");
CREATE INDEX "client_projects_state_idx" ON "client_projects"("state");
CREATE INDEX "client_status_transitions_client_project_id_at_idx" ON "client_status_transitions"("client_project_id", "at");
CREATE UNIQUE INDEX "briefing_links_token_hash_key" ON "briefing_links"("token_hash");
CREATE INDEX "briefing_links_client_project_id_idx" ON "briefing_links"("client_project_id");
CREATE INDEX "audit_events_tenant_id_at_idx" ON "audit_events"("tenant_id", "at");
CREATE INDEX "audit_events_subject_idx" ON "audit_events"("subject");

-- ========================================================================
-- (4) Chaves estrangeiras
-- ========================================================================

ALTER TABLE "clients" ADD CONSTRAINT "clients_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "client_projects" ADD CONSTRAINT "client_projects_client_id_fkey"
  FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "client_status_transitions" ADD CONSTRAINT "client_status_transitions_client_project_id_fkey"
  FOREIGN KEY ("client_project_id") REFERENCES "client_projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "briefing_links" ADD CONSTRAINT "briefing_links_client_project_id_fkey"
  FOREIGN KEY ("client_project_id") REFERENCES "client_projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ========================================================================
-- (5) RLS — mesmo desenho da SPEC-022/ADR-020
--
-- Raízes (`clients`, `audit_events`) filtram por `tenant_id = ANY(contexto)`.
-- Filhas herdam por join à raiz — a RLS da raiz já corta a subquery.
--
-- FORCE: sem ele o Postgres pula a policy para o OWNER da tabela. O runtime
-- roda como `proplan_app` (não-owner), mas FORCE fecha a porta para o caso de
-- alguém apontar a app para a role errada.
--
-- Fail-closed: sem `app.tenant_ids` no contexto, `NULLIF(...,'')` vira NULL,
-- `= ANY(NULL)` é NULL, e a policy não devolve linha nenhuma — que é o
-- critério de aceite "SELECT direto devolve zero linhas".
-- ========================================================================

-- Raízes.
ALTER TABLE "clients" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "clients" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "clients"
  USING ("tenant_id" = ANY (NULLIF(current_setting('app.tenant_ids', true), '')::text[]));

ALTER TABLE "audit_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "audit_events" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "audit_events"
  USING ("tenant_id" = ANY (NULLIF(current_setting('app.tenant_ids', true), '')::text[]));

-- Filha direta de `clients`.
ALTER TABLE "client_projects" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "client_projects" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "client_projects"
  USING ("client_id" IN (
    SELECT id FROM clients
    WHERE tenant_id = ANY (NULLIF(current_setting('app.tenant_ids', true), '')::text[])
  ));

-- Netas: join até `clients` passando por `client_projects`.
ALTER TABLE "client_status_transitions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "client_status_transitions" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "client_status_transitions"
  USING ("client_project_id" IN (
    SELECT cp.id FROM client_projects cp
    JOIN clients c ON c.id = cp.client_id
    WHERE c.tenant_id = ANY (NULLIF(current_setting('app.tenant_ids', true), '')::text[])
  ));

ALTER TABLE "briefing_links" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "briefing_links" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "briefing_links"
  USING ("client_project_id" IN (
    SELECT cp.id FROM client_projects cp
    JOIN clients c ON c.id = cp.client_id
    WHERE c.tenant_id = ANY (NULLIF(current_setting('app.tenant_ids', true), '')::text[])
  ));

-- Grants para `proplan_app`: NÃO vão aqui. O `scripts/bootstrap-app-role.mjs`
-- já roda `ALTER DEFAULT PRIVILEGES ... GRANT ... ON TABLES`, que cobre as
-- tabelas que as migrations criarem depois. Repetir o grant nesta migration
-- seria redundância que envelhece mal (divergiria do bootstrap na próxima
-- mudança de privilégio).
