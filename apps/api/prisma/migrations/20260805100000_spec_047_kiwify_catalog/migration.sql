-- ===========================================================================
-- SPEC-047 (Fatia 36) — o catálogo da Kiwify entra no ProPlan.
--
-- Duas coisas, uma migration aditiva:
--
-- 1. Três credenciais da API pública no `lic_settings`, **todas opcionais** —
--    mesma lição do FIX #212: propósitos independentes não se bloqueiam. Sem
--    elas, tudo segue como antes (o job pula o tenant, o botão fica desabilitado).
--
-- 2. `lic_catalog_snapshots`: o retrato do catálogo, **cache com carimbo**, não
--    tabela de decisão. Nenhuma coluna de conclusão — o cruzamento com
--    `lic_offer_mappings` é derivado na leitura (SPEC-045/046).
-- ===========================================================================

ALTER TABLE "lic_settings" ADD COLUMN "kiwify_client_id" TEXT;
ALTER TABLE "lic_settings" ADD COLUMN "kiwify_client_secret" TEXT;
ALTER TABLE "lic_settings" ADD COLUMN "kiwify_account_id" TEXT;

CREATE TABLE "lic_catalog_snapshots" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "fetched_at" TIMESTAMP(3) NOT NULL,
    "fetch_error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lic_catalog_snapshots_pkey" PRIMARY KEY ("id")
);

-- Uma linha por tenant, sobrescrita a cada rodada (§O snapshot). O unique é o
-- que garante isso no banco, e não só na intenção do `upsert`: duas rodadas
-- concorrentes (job de madrugada + clique no botão) não podem produzir dois
-- retratos e deixar a leitura escolher um por `orderBy`.
CREATE UNIQUE INDEX "lic_catalog_snapshots_tenant_id_key"
  ON "lic_catalog_snapshots"("tenant_id");

ALTER TABLE "lic_catalog_snapshots"
  ADD CONSTRAINT "lic_catalog_snapshots_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- Raiz de tenancy como as demais `lic_*` (ADR-020). Aqui a policy também protege
-- o caminho de ESCRITA fora de request: o job roda sem sessão, e sem
-- `runInTenantContext` o RLS fail-closed devolveria zero linhas em silêncio.
ALTER TABLE "lic_catalog_snapshots" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "lic_catalog_snapshots" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "lic_catalog_snapshots"
  USING ("tenant_id" = ANY (NULLIF(current_setting('app.tenant_ids', true), '')::text[]));
