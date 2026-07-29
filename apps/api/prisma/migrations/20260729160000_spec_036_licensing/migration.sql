-- SPEC-036 — Licenciamento: produtos, edições, licenças, ativações e trilha.
--
-- PR-1 da Fatia 25 (1ª do MVP4). Só o schema: sem módulo, sem rota, sem
-- assinatura Ed25519 — mesmo recorte do PR-1 da SPEC-034, e pelo mesmo motivo.
-- A forma dos dados é a decisão mais cara de desfazer.
--
-- A regra que organiza o arquivo inteiro: **a chave em claro não existe aqui.**
-- Ela é devolvida uma única vez na resposta da emissão e some; o que persiste é
-- o `key_hash`. Não há coluna que a guarde, então não há caminho de leitura que
-- a revele — nem para o admin, nem para quem tiver acesso ao banco.

-- ===========================================================================
-- Enums
-- ===========================================================================

-- Os dois nascem juntos (MVP4 decisão 3) mesmo com o piloto usando só
-- PERPETUAL: a alternativa era um schema que só sabe perpétua e uma migração
-- de dados quando a primeira assinatura chegar.
CREATE TYPE "LicBillingModel" AS ENUM ('PERPETUAL', 'SUBSCRIPTION');

-- REVOKED é ato do admin (reembolso, chargeback); EXPIRED é consequência do
-- relógio sobre `expires_at`. Separados porque respondem perguntas diferentes
-- no suporte: "foi cancelada?" ≠ "venceu?". Sem TRIAL — a decisão 4 do MVP4
-- tirou trial do produto.
CREATE TYPE "LicenseStatus" AS ENUM ('ACTIVE', 'REVOKED', 'EXPIRED');

-- ===========================================================================
-- lic_products — produto licenciável do tenant. Raiz de tenancy.
-- ===========================================================================
CREATE TABLE "lic_products" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    -- O `WR` de `WR-XXXX-XXXX-XXXX-XXXX`. Vem daqui e não de constante no
    -- código (MVP4 §4): senão o segundo produto do tenant emitiria chave com o
    -- prefixo do primeiro.
    "key_prefix" TEXT NOT NULL,
    -- Costura futura com o catálogo (MVP4 §4). Opcional porque o War Room é
    -- vendido sem que seu repo esteja no catálogo — exigir o vínculo tornaria
    -- o licenciamento refém da ingestão.
    "project_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lic_products_pkey" PRIMARY KEY ("id")
);

-- Slug único POR TENANT, não global: dois tenants podem vender um `warroom`
-- cada um, e nada relaciona os dois.
CREATE UNIQUE INDEX "lic_products_tenant_id_slug_key" ON "lic_products"("tenant_id", "slug");

-- Produto sem slug, nome ou prefixo produz chave malformada e um item de menu
-- sem rótulo. O CHECK barra a string vazia, que é o que passa por NOT NULL sem
-- dizer nada.
ALTER TABLE "lic_products"
  ADD CONSTRAINT "lic_products_identity_present"
  CHECK (length(btrim("slug")) > 0 AND length(btrim("name")) > 0
     AND length(btrim("key_prefix")) > 0);

-- ===========================================================================
-- lic_editions — o que muda entre "com" e "sem código-fonte".
--
-- ÚNICA tabela `Lic*` sem `tenant_id`: corta por JOIN no produto dono, porque
-- nada a busca direto por id — sempre se chega nela pelo produto ou pela
-- licença.
-- ===========================================================================
CREATE TABLE "lic_editions" (
    "id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "billing_model" "LicBillingModel" NOT NULL DEFAULT 'PERPETUAL',
    -- 2 máquinas por licença (decisão do PI): desktop + notebook do mesmo
    -- comprador. Ajustável por edição pelo admin.
    "max_machines" INTEGER NOT NULL DEFAULT 2,
    -- Janela de updates da perpétua. Vira `updates_until` na emissão —
    -- COPIADO, não lido por FK: mudar a política meses depois não pode
    -- encurtar a janela de quem já comprou.
    "updates_months" INTEGER NOT NULL DEFAULT 12,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lic_editions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "lic_editions_product_id_slug_key" ON "lic_editions"("product_id", "slug");

-- Zero máquinas emitiria licença que não ativa em lugar nenhum; zero meses de
-- updates emitiria licença já vencida no dia da compra. Ambos passariam por
-- NOT NULL sem falhar nada.
ALTER TABLE "lic_editions"
  ADD CONSTRAINT "lic_editions_limits_positive"
  CHECK ("max_machines" > 0 AND "updates_months" > 0);

ALTER TABLE "lic_editions"
  ADD CONSTRAINT "lic_editions_identity_present"
  CHECK (length(btrim("slug")) > 0 AND length(btrim("name")) > 0);

-- ===========================================================================
-- licenses — a licença. Raiz de tenancy.
-- ===========================================================================
CREATE TABLE "licenses" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "edition_id" TEXT NOT NULL,
    -- SHA-256 da chave em claro. A chave NUNCA é persistida.
    "key_hash" TEXT NOT NULL,
    "status" "LicenseStatus" NOT NULL DEFAULT 'ACTIVE',
    "customer_email" TEXT NOT NULL,
    "customer_name" TEXT,
    -- Id da venda na plataforma (Kiwify etc). O UNIQUE é a idempotência do
    -- webhook da SPEC-038: reentrega do mesmo evento não emite a segunda
    -- licença. Nulo nesta fatia — a emissão é manual, não tem venda associada.
    "sale_ref" TEXT,
    "issued_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updates_until" TIMESTAMP(3) NOT NULL,
    -- Nulo em PERPETUAL. Usado pela SPEC-038 em SUBSCRIPTION.
    "expires_at" TIMESTAMP(3),
    "revoked_at" TIMESTAMP(3),
    "revoked_reason" TEXT,
    -- Convite do repo privado na edição source (SPEC-039, dia 8). Nascem aqui
    -- para que o job daquela fatia não precise de migração de dados.
    "source_invite_at" TIMESTAMP(3),
    "source_invited" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "licenses_pkey" PRIMARY KEY ("id")
);

-- O único caminho de busca pela chave: o `/activate` hasheia o que recebe e
-- procura por igualdade. O índice único é o que torna esse lookup uma operação
-- e não uma varredura da tabela inteira a cada ativação.
CREATE UNIQUE INDEX "licenses_key_hash_key" ON "licenses"("key_hash");
CREATE UNIQUE INDEX "licenses_sale_ref_key" ON "licenses"("sale_ref");

-- A busca do admin é por e-mail do comprador, dentro do tenant.
CREATE INDEX "licenses_tenant_id_customer_email_idx" ON "licenses"("tenant_id", "customer_email");
CREATE INDEX "licenses_tenant_id_issued_at_idx" ON "licenses"("tenant_id", "issued_at");

-- Licença sem e-mail do comprador é licença que o suporte não consegue ligar a
-- ninguém — e o e-mail é como a chave chega em quem comprou (SPEC-038).
ALTER TABLE "licenses"
  ADD CONSTRAINT "licenses_customer_email_present"
  CHECK (length(btrim("customer_email")) > 0);

-- Revogar é o ato que o `/activate` responde com 410. Um `status = REVOKED` sem
-- `revoked_at` deixaria a trilha sem a data em que a venda foi desfeita, e um
-- `revoked_at` com status ACTIVE é uma licença que diz duas coisas ao mesmo
-- tempo — o segundo é o que produziria uma ativação indevida.
ALTER TABLE "licenses"
  ADD CONSTRAINT "licenses_revoked_coherent"
  CHECK (("status" = 'REVOKED') = ("revoked_at" IS NOT NULL));

-- ===========================================================================
-- lic_activations — máquina ativada. Raiz de tenancy: o painel da SPEC-040
-- lista ativações por tenant sem passar pela licença.
-- ===========================================================================
CREATE TABLE "lic_activations" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "license_id" TEXT NOT NULL,
    -- OPACO para o servidor: hash calculado no cliente, comparado só por
    -- igualdade. O servidor nunca recebe MAC em claro (MVP4 §7).
    "fingerprint" TEXT NOT NULL,
    -- Só para exibição no suporte ("qual das duas máquinas é essa?").
    "hostname" TEXT,
    "app_version" TEXT,
    "activated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    -- Preenchido pelo `/deactivate` da SPEC-037. A linha sai da contagem de
    -- vagas sem sair da trilha — apagar esconderia a troca de máquina do
    -- suporte.
    "deactivated_at" TIMESTAMP(3),

    CONSTRAINT "lic_activations_pkey" PRIMARY KEY ("id")
);

-- A idempotência do `/activate`: mesma chave + mesma máquina reativa a linha
-- existente em vez de consumir a segunda vaga. É o índice que garante isso, não
-- o código — duas requisições simultâneas passariam as duas por um `if`.
CREATE UNIQUE INDEX "lic_activations_license_id_fingerprint_key" ON "lic_activations"("license_id", "fingerprint");
CREATE INDEX "lic_activations_tenant_id_last_seen_at_idx" ON "lic_activations"("tenant_id", "last_seen_at");

ALTER TABLE "lic_activations"
  ADD CONSTRAINT "lic_activations_fingerprint_present"
  CHECK (length(btrim("fingerprint")) > 0);

-- ===========================================================================
-- lic_events — trilha do que aconteceu com a licença. Raiz de tenancy,
-- append-only.
--
-- `type` é TEXT e não enum de propósito: as fatias 27–28 acrescentam
-- `webhook_renewed`, `webhook_overdue`, `webhook_canceled`, `source_invited`
-- (MVP4 §4). Um enum forçaria migração de schema a cada evento novo, e o custo
-- não se paga — nada no banco decide comportamento a partir deste valor.
-- ===========================================================================
CREATE TABLE "lic_events" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "license_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    -- Contexto do evento: IP da ativação, motivo da revogação, valor pago que
    -- chega do webhook (MVP4 decisão 4 — preço NÃO vira coluna).
    "payload" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lic_events_pkey" PRIMARY KEY ("id")
);

-- A leitura é sempre "a trilha desta licença, mais recente primeiro".
CREATE INDEX "lic_events_license_id_created_at_idx" ON "lic_events"("license_id", "created_at");

ALTER TABLE "lic_events"
  ADD CONSTRAINT "lic_events_type_present"
  CHECK (length(btrim("type")) > 0);

-- ===========================================================================
-- Chaves estrangeiras
-- ===========================================================================

ALTER TABLE "lic_products" ADD CONSTRAINT "lic_products_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- SetNull e não Cascade: desconectar o repo do catálogo não pode apagar o
-- produto — junto iriam as licenças já vendidas dele.
ALTER TABLE "lic_products" ADD CONSTRAINT "lic_products_project_id_fkey"
  FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "lic_editions" ADD CONSTRAINT "lic_editions_product_id_fkey"
  FOREIGN KEY ("product_id") REFERENCES "lic_products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "licenses" ADD CONSTRAINT "licenses_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Restrict: apagar uma edição levaria junto as licenças vendidas nela, e com
-- elas a resposta a "o que este cliente comprou?".
ALTER TABLE "licenses" ADD CONSTRAINT "licenses_edition_id_fkey"
  FOREIGN KEY ("edition_id") REFERENCES "lic_editions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "lic_activations" ADD CONSTRAINT "lic_activations_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "lic_activations" ADD CONSTRAINT "lic_activations_license_id_fkey"
  FOREIGN KEY ("license_id") REFERENCES "licenses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "lic_events" ADD CONSTRAINT "lic_events_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "lic_events" ADD CONSTRAINT "lic_events_license_id_fkey"
  FOREIGN KEY ("license_id") REFERENCES "licenses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ===========================================================================
-- RLS (ADR-020, MVP4 decisão 2)
--
-- Mesma policy do resto da casa: `tenant_id = ANY(app.tenant_ids)`. Fail-closed
-- — sem contexto, nenhuma linha. `FORCE` porque o owner da tabela também
-- precisa obedecer.
-- ===========================================================================

ALTER TABLE "lic_products" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "lic_products" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "lic_products"
  USING ("tenant_id" = ANY (NULLIF(current_setting('app.tenant_ids', true), '')::text[]));

ALTER TABLE "licenses" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "licenses" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "licenses"
  USING ("tenant_id" = ANY (NULLIF(current_setting('app.tenant_ids', true), '')::text[]));

ALTER TABLE "lic_activations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "lic_activations" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "lic_activations"
  USING ("tenant_id" = ANY (NULLIF(current_setting('app.tenant_ids', true), '')::text[]));

ALTER TABLE "lic_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "lic_events" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "lic_events"
  USING ("tenant_id" = ANY (NULLIF(current_setting('app.tenant_ids', true), '')::text[]));

-- Filha por JOIN: o corte vem do produto dono. É a única `Lic*` sem
-- `tenant_id`, porque nada a busca direto por id.
ALTER TABLE "lic_editions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "lic_editions" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "lic_editions"
  USING (EXISTS (
    SELECT 1 FROM "lic_products" p
    WHERE p."id" = "lic_editions"."product_id"
      AND p."tenant_id" = ANY (NULLIF(current_setting('app.tenant_ids', true), '')::text[])
  ));

-- ===========================================================================
-- resolve_license — o lookup do `/activate`, sem contexto de tenant.
--
-- Espelha a `resolve_contract_link` (SPEC-034) e a `resolve_briefing_link`
-- (SPEC-029) porque o problema é o mesmo: `POST /licensing/v1/activate` não tem
-- sessão, então roda sem `app.tenant_ids`, e o RLS fail-closed devolveria vazio
-- para TODA chave — inclusive as válidas.
--
-- A saída é deliberadamente estreita: o que a licença é (status, limites,
-- janelas) e de que tenant ela vem. **Nada do comprador sai daqui** — nome e
-- e-mail não são necessários para decidir uma ativação, e uma função com
-- privilégio de owner não deve devolver dado pessoal a uma rota sem sessão. O
-- resto é lido depois, já sob o contexto do tenant que ela devolveu, de modo
-- que o RLS continue sendo o que protege o conteúdo — e não a lista de colunas
-- de uma função privilegiada.
-- ===========================================================================
CREATE OR REPLACE FUNCTION resolve_license(p_key_hash text)
RETURNS TABLE (
  id text,
  tenant_id text,
  status text,
  expires_at timestamp(3),
  updates_until timestamp(3),
  max_machines integer,
  edition_slug text,
  billing_model text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT l.id, l.tenant_id, l.status::text, l.expires_at, l.updates_until,
         e.max_machines, e.slug, e.billing_model::text
  FROM licenses l
  JOIN lic_editions e ON e.id = l.edition_id
  WHERE l.key_hash = p_key_hash
  LIMIT 1;
$$;

-- A função é o único caminho: `proplan_app` continua sem enxergar as tabelas
-- fora de contexto (o RLS não muda). REVOKE de PUBLIC + GRANT explícito para
-- que só a role da aplicação possa chamá-la.
REVOKE ALL ON FUNCTION resolve_license(text) FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'proplan_app') THEN
    GRANT EXECUTE ON FUNCTION resolve_license(text) TO proplan_app;
  END IF;
END $$;
