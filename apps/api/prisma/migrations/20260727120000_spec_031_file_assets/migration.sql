-- SPEC-031 (Fatia 20) — anexos do briefing público (`file_assets`).
--
-- Esta é a tabela que o ADR-025 autorizou, e ela chega DEPOIS dele de
-- propósito: a migration do briefing (20260727000000) deixou o comentário
-- dizendo que `file_assets` dependia da decisão sobre onde vive binário de
-- cliente. Decidido em 2026-07-26: Postgres, `bytea`, sob RLS.
--
-- Três escolhas do ADR que viram DDL aqui:
--
-- 1. **`bytea`, nunca Large Object.** LO vive no catálogo `pg_largeobject`,
--    fora da tabela: escaparia da policy de linha e exigiria API dedicada.
--    `bytea` é uma coluna como outra qualquer — a policy da linha vale para
--    ela, e o TOAST cuida de comprimir e guardar fora da página.
-- 2. **`tenant_id` na própria linha**, não herdado por JOIN. As outras tabelas
--    do briefing são netas/bisnetas e herdam o corte atravessando até
--    `clients`; esta não pode: o download autenticado (`/t/:tenant/files/:id`)
--    busca o anexo por `id` sem passar pelo rascunho, e um JOIN de três níveis
--    no caminho do download seria a diferença entre uma policy simples e uma
--    que ninguém relê. Raiz de tenancy, igual a `service_catalog_items`.
-- 3. **Dono opcional dos dois lados** (`briefing_draft_id`, `briefing_version_id`):
--    o anexo nasce preso ao rascunho e, no submit, passa a apontar também para
--    a versão. Guardar os dois em vez de mover preserva a trilha — a versão é
--    imutável (spec §5) e precisa continuar sabendo quais bytes recebeu.

CREATE TABLE "file_assets" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "briefing_draft_id" TEXT,
    "briefing_version_id" TEXT,
    -- Nome ORIGINAL, saneado, só para exibição. Nunca usado como caminho.
    "name" TEXT NOT NULL,
    -- Nome gerado pelo servidor: `<id>.<ext do mime DETECTADO>`.
    "safe_name" TEXT NOT NULL,
    -- MIME detectado pela assinatura de bytes — nunca o Content-Type do request.
    "mime" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "bytes" BYTEA NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "file_assets_pkey" PRIMARY KEY ("id")
);

-- Cota por briefing (5 arquivos / 25 MB) é contada por rascunho: este índice é
-- o que faz o COUNT/SUM da checagem não varrer a tabela inteira a cada upload.
CREATE INDEX "file_assets_briefing_draft_id_idx" ON "file_assets"("briefing_draft_id");
CREATE INDEX "file_assets_briefing_version_id_idx" ON "file_assets"("briefing_version_id");
CREATE INDEX "file_assets_tenant_id_created_at_idx" ON "file_assets"("tenant_id", "created_at");

-- Allowlist NO BANCO, além da checagem de assinatura no domain.
--
-- Redundante de propósito: a barreira real é a verificação de bytes, mas um
-- caminho de escrita futuro que esqueça de chamá-la (import, migração de dados,
-- correção manual) esbarra aqui. Defesa em profundidade custa uma linha.
ALTER TABLE "file_assets" ADD CONSTRAINT "file_assets_mime_allowlist"
  CHECK ("mime" IN ('image/png', 'image/jpeg', 'image/webp', 'application/pdf'));

-- Teto de 10 MB por arquivo, também no banco (ADR-025 item 3). Passar daqui
-- não é bug de aplicação: é o gatilho de revisão do ADR sendo puxado.
ALTER TABLE "file_assets" ADD CONSTRAINT "file_assets_size_limit"
  CHECK ("size" > 0 AND "size" <= 10485760);

-- `size` precisa refletir os bytes gravados. Sem isto, a soma da cota poderia
-- ser burlada gravando `size` pequeno com `bytes` grande.
ALTER TABLE "file_assets" ADD CONSTRAINT "file_assets_size_matches_bytes"
  CHECK ("size" = octet_length("bytes"));

-- Anexo órfão não existe: ou pertence a um rascunho, ou a uma versão, ou aos
-- dois (o caso normal depois do submit).
ALTER TABLE "file_assets" ADD CONSTRAINT "file_assets_has_owner"
  CHECK ("briefing_draft_id" IS NOT NULL OR "briefing_version_id" IS NOT NULL);

ALTER TABLE "file_assets" ADD CONSTRAINT "file_assets_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- SET NULL, não CASCADE: apagar o rascunho não pode levar junto o anexo que a
-- versão enviada referencia. O CHECK acima garante que ele ainda terá dono.
ALTER TABLE "file_assets" ADD CONSTRAINT "file_assets_briefing_draft_id_fkey"
  FOREIGN KEY ("briefing_draft_id") REFERENCES "briefing_drafts"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "file_assets" ADD CONSTRAINT "file_assets_briefing_version_id_fkey"
  FOREIGN KEY ("briefing_version_id") REFERENCES "briefing_versions"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- ===========================================================================
-- RLS — o motivo de o ADR-025 ter escolhido o Postgres em vez de um bucket.
--
-- FORCE: sem ele o Postgres pula a policy para o OWNER da tabela.
-- Fail-closed: sem `app.tenant_ids`, `NULLIF(...,'')` vira NULL, `= ANY(NULL)`
-- é NULL, e nenhuma linha sai — provado no `briefing-rls.int-spec.ts`.
-- ===========================================================================
ALTER TABLE "file_assets" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "file_assets" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "file_assets"
  USING ("tenant_id" = ANY (NULLIF(current_setting('app.tenant_ids', true), '')::text[]));

-- ---------------------------------------------------------------------------
-- Cota do briefing, resolvida SEM contexto de tenant.
--
-- Mesmo problema das outras rotas públicas: o upload em `/b/:token` não tem
-- sessão, o RLS é fail-closed, e um SELECT direto para somar a cota voltaria
-- zero — o que faria o 6º arquivo passar como se fosse o 1º. A cota seria
-- decorativa.
--
-- Recebe o id do rascunho (já resolvido pelo hash do token, dentro do mesmo
-- request) e devolve só dois números. Não lista, não devolve bytes, não devolve
-- nome. `search_path` fixo é obrigatório em SECURITY DEFINER.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION briefing_draft_quota(p_draft_id text)
RETURNS TABLE (file_count integer, total_bytes bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    count(*)::int,
    COALESCE(sum(fa.size), 0)::bigint
  FROM file_assets fa
  WHERE fa.briefing_draft_id = p_draft_id;
$$;

REVOKE ALL ON FUNCTION briefing_draft_quota(text) FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'proplan_app') THEN
    GRANT EXECUTE ON FUNCTION briefing_draft_quota(text) TO proplan_app;
  END IF;
END $$;
