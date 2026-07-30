-- ===========================================================================
-- SPEC-041 (Fatia 30) — lic_releases: a versão publicada do produto.
--
-- **Ponteiro, não arquivo.** Os bytes do instalador vivem na Release privada do
-- GitHub (ADR-028); aqui ficam só `asset_id`, `sha256` e a data que decide a
-- autorização. Nenhum byte entra no Postgres nem atravessa a API.
--
-- Raiz de tenancy, ao contrário de `lic_editions`: o caminho público
-- (`releases/check` e `releases/download`) chega nesta tabela por
-- `(licença → produto, versão)`, sem nenhum id de linha vindo do cliente. Um
-- filtro esquecido ali serviria release de outro tenant, e a policy é o que
-- fecha isso sem depender de lembrança.
-- ===========================================================================
CREATE TABLE "lic_releases" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "os" TEXT NOT NULL,
    "released_at" TIMESTAMP(3) NOT NULL,
    "asset_id" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "notes" TEXT,
    "published" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lic_releases_pkey" PRIMARY KEY ("id")
);

-- A mesma versão só existe uma vez por plataforma. Sem isto, `1.2.0/win-x64`
-- registrado duas vezes daria duas respostas possíveis ao `check`, e a escolhida
-- seria a que o banco devolvesse primeiro.
CREATE UNIQUE INDEX "lic_releases_product_id_version_os_key"
  ON "lic_releases"("product_id", "version", "os");

-- A leitura do `check`: as versões deste produto, mais nova primeiro.
CREATE INDEX "lic_releases_product_id_released_at_idx"
  ON "lic_releases"("product_id", "released_at");

-- Versão sem semver, sem alvo, sem asset ou sem hash é linha que o `download`
-- não consegue honrar — e o sintoma apareceria só na máquina do cliente, como
-- update que não baixa. O CHECK barra a string vazia, que passa por NOT NULL sem
-- dizer nada.
ALTER TABLE "lic_releases"
  ADD CONSTRAINT "lic_releases_identity_present"
  CHECK (length(btrim("version")) > 0 AND length(btrim("os")) > 0
     AND length(btrim("asset_id")) > 0);

-- O `sha256` é conferido pela máquina do cliente depois de baixar; um valor
-- malformado só falharia lá, depois de 80 MB transferidos, e o operador leria
-- como "download corrompido". Recusar no banco mantém a mentira fora da tabela:
-- 64 dígitos hex, caixa indiferente.
ALTER TABLE "lic_releases"
  ADD CONSTRAINT "lic_releases_sha256_format"
  CHECK ("sha256" ~ '^[0-9a-fA-F]{64}$');

ALTER TABLE "lic_releases"
  ADD CONSTRAINT "lic_releases_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "lic_releases"
  ADD CONSTRAINT "lic_releases_product_id_fkey"
  FOREIGN KEY ("product_id") REFERENCES "lic_products"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- Isolamento por linha, como as demais `lic_*` (ADR-020).
ALTER TABLE "lic_releases" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "lic_releases" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "lic_releases"
  USING ("tenant_id" = ANY (NULLIF(current_setting('app.tenant_ids', true), '')::text[]));
