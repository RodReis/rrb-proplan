-- Fatia 8 (SPEC-022) — multi-tenant: Tenant/Membership, tenant_id nas raízes,
-- backfill idempotente do usuário único e RLS em profundidade.
--
-- Ordem obrigatória: (1) estruturas nullable/aditivas → (2) backfill preenche
-- tenant_id → (3) SET NOT NULL + RLS. Não inverter: NOT NULL antes do backfill
-- quebraria; RLS antes do backfill exigiria contexto no próprio UPDATE.

-- ========================================================================
-- (1) Estruturas novas (aditivas, nullable) — geradas pelo Prisma
-- ========================================================================

-- CreateEnum
CREATE TYPE "Role" AS ENUM ('owner', 'member', 'viewer');

-- AlterTable
ALTER TABLE "llm_usage" ADD COLUMN     "tenant_id" TEXT;

-- AlterTable
ALTER TABLE "projects" ADD COLUMN     "tenant_id" TEXT;

-- AlterTable
ALTER TABLE "settings" ADD COLUMN     "tenant_id" TEXT;

-- CreateTable
CREATE TABLE "tenants" (
    "id" TEXT NOT NULL,
    "installation_id" INTEGER,
    "account_login" TEXT NOT NULL,
    "account_type" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tenants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "memberships" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "memberships_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tenants_installation_id_key" ON "tenants"("installation_id");

-- CreateIndex
CREATE INDEX "memberships_tenant_id_idx" ON "memberships"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "memberships_user_id_tenant_id_key" ON "memberships"("user_id", "tenant_id");

-- AddForeignKey
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "settings" ADD CONSTRAINT "settings_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ========================================================================
-- (2) Backfill do usuário único → tenant pessoal (IDEMPOTENTE)
--     Rodar 2× não duplica: id de tenant/membership determinístico por user +
--     ON CONFLICT + UPDATE só onde tenant_id ainda é NULL.
-- ========================================================================

-- Um tenant pessoal por usuário dono de projeto. id determinístico (derivado do
-- md5 do user id, formatado como uuid) → idempotência sem PK aleatória.
-- account_type='User' (pessoal, sem org de instalação).
INSERT INTO "tenants" ("id", "installation_id", "account_login", "account_type", "created_at")
SELECT
  ('00000000-0000-4000-8000-' || substr(md5(u."id"), 1, 12))::text,
  NULL,
  u."login",
  'User',
  now()
FROM "users" u
WHERE EXISTS (SELECT 1 FROM "projects" p WHERE p."user_id" = u."id")
ON CONFLICT ("id") DO NOTHING;

-- Membership owner do dono no seu tenant pessoal.
INSERT INTO "memberships" ("id", "user_id", "tenant_id", "role", "created_at")
SELECT
  ('00000000-0000-4000-9000-' || substr(md5(u."id"), 1, 12))::text,
  u."id",
  ('00000000-0000-4000-8000-' || substr(md5(u."id"), 1, 12))::text,
  'owner'::"Role",
  now()
FROM "users" u
WHERE EXISTS (SELECT 1 FROM "projects" p WHERE p."user_id" = u."id")
ON CONFLICT ("user_id", "tenant_id") DO NOTHING;

-- Projetos → tenant pessoal do dono. Só onde ainda NULL (idempotente).
UPDATE "projects" p
SET "tenant_id" = ('00000000-0000-4000-8000-' || substr(md5(p."user_id"), 1, 12))::text
WHERE p."tenant_id" IS NULL;

-- Settings idem (1:1 com user via @unique user_id).
UPDATE "settings" s
SET "tenant_id" = ('00000000-0000-4000-8000-' || substr(md5(s."user_id"), 1, 12))::text
WHERE s."tenant_id" IS NULL;

-- LlmUsage: derivar via projeto onde houver. Linhas órfãs (project_id NULL — o
-- ledger sobrevive ao projeto) FICAM tenant_id NULL = tenant pessoal histórico
-- (F4). Só preenche onde há projeto com tenant e ainda está NULL.
UPDATE "llm_usage" l
SET "tenant_id" = p."tenant_id"
FROM "projects" p
WHERE l."project_id" = p."id"
  AND l."tenant_id" IS NULL
  AND p."tenant_id" IS NOT NULL;

-- ========================================================================
-- (3) NOT NULL nas raízes obrigatórias. llm_usage FICA nullable (exceção F4).
--     Se sobrou projeto/settings sem tenant, o SET NOT NULL falha — guarda
--     contra backfill incompleto.
-- ========================================================================

ALTER TABLE "projects" ALTER COLUMN "tenant_id" SET NOT NULL;
ALTER TABLE "settings" ALTER COLUMN "tenant_id" SET NOT NULL;

-- ========================================================================
-- (4) RLS em profundidade. FORCE para valer até ao owner em teste; o runtime
--     conecta como proplan_app (não-owner) de qualquer forma. Contexto por
--     request: current_setting('app.tenant_id', true) (SET LOCAL, PR-3). O 2º
--     arg 'true' = missing_ok: var ausente → NULL → nenhuma linha casa
--     (fail-closed, nunca vaza por falta de contexto).
-- ========================================================================

-- Raízes: casam direto por tenant_id.
ALTER TABLE "projects" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "projects" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "projects"
  USING ("tenant_id" = current_setting('app.tenant_id', true));

ALTER TABLE "settings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "settings" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "settings"
  USING ("tenant_id" = current_setting('app.tenant_id', true));

-- llm_usage: nullable — NULL (histórico órfão) pertence ao tenant ativo.
ALTER TABLE "llm_usage" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "llm_usage" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "llm_usage"
  USING ("tenant_id" = current_setting('app.tenant_id', true) OR "tenant_id" IS NULL);

-- Filhas: herdam por join à projects. A RLS de projects já corta a subquery →
-- defesa em profundidade automática, sem coluna tenant_id própria nas 13.
DO $$
DECLARE
  t text;
  child_tables text[] := ARRAY[
    'documents', 'doc_links', 'document_resolutions', 'canonical_fields',
    'assertions', 'insights', 'insight_runs', 'sync_runs', 'board_mutations',
    'operations', 'suppressed_links', 'issues'
  ];
BEGIN
  FOREACH t IN ARRAY child_tables LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY "tenant_isolation" ON %I USING ('
      || 'project_id IN (SELECT id FROM projects WHERE tenant_id = current_setting(''app.tenant_id'', true)))',
      t
    );
  END LOOP;
END $$;
