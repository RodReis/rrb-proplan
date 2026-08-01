-- ===========================================================================
-- SPEC-043 (Fatia 32) — lic_error_reports: o bug do app chega com contexto.
--
-- Raiz de tenancy, como as demais `lic_*` (ADR-020). O caminho público
-- (`POST /licensing/v1/errors`) chega aqui por `keyHash → License`, sem nenhum
-- id de linha vindo do cliente — a policy fecha o que um filtro esquecido no
-- código abriria.
--
-- **O e-mail do comprador não tem coluna aqui** (§Notas técnicas): a correlação
-- acontece na leitura, por JOIN com `licenses`. Uma cópia nesta tabela seria um
-- segundo lugar onde o dado pessoal vive, que a exclusão a pedido teria de
-- lembrar de limpar.
-- ===========================================================================
CREATE TYPE "LicErrorSource" AS ENUM ('CRASH', 'MANUAL');
CREATE TYPE "LicErrorStatus" AS ENUM ('NEW', 'TRIAGED', 'RESOLVED');

CREATE TABLE "lic_error_reports" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "license_id" TEXT NOT NULL,
    "app_version" TEXT NOT NULL,
    "os" TEXT NOT NULL,
    "occurred_at" TIMESTAMP(3) NOT NULL,
    "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "message" TEXT NOT NULL,
    "stack" TEXT,
    "session_tail" JSONB,
    "source" "LicErrorSource" NOT NULL,
    "user_note" TEXT,
    "contact_email" TEXT,
    "status" "LicErrorStatus" NOT NULL DEFAULT 'NEW',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lic_error_reports_pkey" PRIMARY KEY ("id")
);

-- A lista do admin: os novos primeiro, dentro do tenant.
CREATE INDEX "lic_error_reports_tenant_id_status_idx"
  ON "lic_error_reports"("tenant_id", "status");

-- "O que este cliente relatou?" — a pergunta do detalhe da licença, e a
-- varredura da exclusão a pedido.
CREATE INDEX "lic_error_reports_license_id_idx"
  ON "lic_error_reports"("license_id");

-- O agrupamento por mensagem com contagem (§Escopo). Sem ele, agrupar é
-- varredura da tabela a cada abertura da aba.
CREATE INDEX "lic_error_reports_message_idx"
  ON "lic_error_reports"("message");

-- O purge varre por `received_at`, não por `occurred_at`: a retenção de 90 dias
-- conta do que está aqui. Um relógio adiantado na máquina do cliente não pode
-- empurrar um relato para fora da janela antes da hora — nem um atrasado
-- mantê-lo além dela.
CREATE INDEX "lic_error_reports_received_at_idx"
  ON "lic_error_reports"("received_at");

-- Relato sem mensagem é linha que não diz nada: a lista do admin agrupa por
-- `message`, e o grupo vazio afogaria os que têm conteúdo. NOT NULL sozinho
-- deixa passar a string vazia — o CHECK é o que a barra.
ALTER TABLE "lic_error_reports"
  ADD CONSTRAINT "lic_error_reports_message_present"
  CHECK (length(btrim("message")) > 0);

ALTER TABLE "lic_error_reports"
  ADD CONSTRAINT "lic_error_reports_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- Cascade, ao contrário do `SetNull` de `lic_webhook_events`: aquele guarda a
-- prova de que a venda chegou e precisa sobreviver à licença; este é diagnóstico
-- de um app que aquela licença rodava. Sem a licença ele não tem a quem
-- responder, que é a única razão de ele existir.
ALTER TABLE "lic_error_reports"
  ADD CONSTRAINT "lic_error_reports_license_id_fkey"
  FOREIGN KEY ("license_id") REFERENCES "licenses"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "lic_error_reports" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "lic_error_reports" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "lic_error_reports"
  USING ("tenant_id" = ANY (NULLIF(current_setting('app.tenant_ids', true), '')::text[]));
