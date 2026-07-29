-- SPEC-038 — a venda vira licença sem ninguém no meio: o que chega da
-- plataforma, o que sai por e-mail e o que configura os dois.
--
-- PR-1 da Fatia 27 (3ª do MVP4). Só o schema: sem módulo `mail`, sem rota de
-- webhook, sem job — mesmo recorte do PR-1 da SPEC-036, e pelo mesmo motivo. A
-- forma dos dados é a decisão mais cara de desfazer.
--
-- A regra que organiza o arquivo: **receber ≠ processar**. A rota grava o
-- evento bruto e responde `200`; quem entende o evento é um job. Plataforma de
-- pagamento tem timeout curto e reenvia o que demora — processar dentro da
-- request transformaria lentidão em enxurrada de duplicatas. O UNIQUE de
-- `(platform, external_event_id)` é o que torna a reentrega inofensiva, e ele
-- está no BANCO e não num `if`: duas entregas simultâneas passariam as duas
-- por um `if`.

-- ===========================================================================
-- Enums
-- ===========================================================================

-- IGNORED não é erro: a plataforma acrescenta tipos de evento sem avisar, e
-- tratar tipo desconhecido como falha encheria a lista de pendências do admin
-- de coisas que não têm conserto.
CREATE TYPE "LicWebhookStatus" AS ENUM ('PENDING', 'PROCESSED', 'FAILED', 'IGNORED');

CREATE TYPE "MailDeliveryStatus" AS ENUM ('PENDING', 'SENT', 'FAILED');

-- ===========================================================================
-- licenses.past_due_at — inadimplência SEM mudar o status.
--
-- Cartão recusado é rotina e a própria plataforma retenta; derrubar o acesso no
-- primeiro atraso pune o cliente por um evento que ainda vai se resolver
-- sozinho. O corte, quando vem, sai da comparação
-- `past_due_at + past_due_tolerance_days < now` feita na VALIDAÇÃO — nunca de
-- um job, porque job diário atrasado ou morto não pode conceder acesso.
-- ===========================================================================
ALTER TABLE "licenses" ADD COLUMN "past_due_at" TIMESTAMP(3);

-- ===========================================================================
-- lic_webhook_events — o que a plataforma mandou, gravado ANTES de ser
-- entendido. Raiz de tenancy.
-- ===========================================================================
CREATE TABLE "lic_webhook_events" (
    "id" TEXT NOT NULL,
    -- NOT NULL apesar de a spec escrevê-lo opcional: o tenant sai da própria
    -- URL (`/:tenantSlug`), então existe antes de qualquer leitura — inclusive
    -- para o evento cuja oferta não está mapeada, que é justamente o que mais
    -- precisa aparecer no admin de alguém.
    "tenant_id" TEXT NOT NULL,
    -- `kiwify` hoje. TEXT e não enum: a fronteira do adapter é o que abre
    -- Hotmart/Lemon sem migration.
    "platform" TEXT NOT NULL,
    "external_event_id" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    -- Bruto, como chegou. É o que torna o reprocessamento possível sem pedir
    -- reenvio à plataforma — e o que guarda o preço, que não vira coluna
    -- (MVP4 decisão 4).
    "payload" JSONB NOT NULL,
    "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed_at" TIMESTAMP(3),
    "status" "LicWebhookStatus" NOT NULL DEFAULT 'PENDING',
    -- Motivo legível: "oferta X sem mapeamento", "licença não encontrada". É o
    -- que o admin lê antes de decidir reprocessar.
    "error" TEXT,
    "license_id" TEXT,

    CONSTRAINT "lic_webhook_events_pkey" PRIMARY KEY ("id")
);

-- **A idempotência é do RECEBIMENTO, não do processador.** Sem `tenant_id` na
-- chave, de propósito: um id de evento da Kiwify é único na Kiwify, e incluir o
-- tenant deixaria a MESMA entrega ser gravada duas vezes se chegasse em duas
-- URLs.
CREATE UNIQUE INDEX "lic_webhook_events_platform_external_event_id_key"
  ON "lic_webhook_events"("platform", "external_event_id");

-- A lista do admin: filtra por status, mais recentes no topo.
CREATE INDEX "lic_webhook_events_tenant_id_status_received_at_idx"
  ON "lic_webhook_events"("tenant_id", "status", "received_at");

-- Evento sem plataforma, sem id externo ou sem tipo é evento que ninguém
-- consegue reprocessar nem correlacionar com a plataforma. String vazia passa
-- por NOT NULL sem dizer nada.
ALTER TABLE "lic_webhook_events"
  ADD CONSTRAINT "lic_webhook_events_identity_present"
  CHECK (length(btrim("platform")) > 0 AND length(btrim("external_event_id")) > 0
     AND length(btrim("event_type")) > 0);

-- `processed_at` é o carimbo de "saiu de PENDING". Um evento PROCESSED sem data
-- deixaria a trilha sem quando a venda virou licença; um PENDING com data
-- diria que foi processado e não foi. IGNORED e FAILED também carimbam — os
-- dois são desfechos, e "quando desistimos disto?" é pergunta do suporte.
ALTER TABLE "lic_webhook_events"
  ADD CONSTRAINT "lic_webhook_events_processed_coherent"
  CHECK (("status" = 'PENDING') = ("processed_at" IS NULL));

-- FAILED sem motivo é o item da lista de pendências que ninguém sabe como
-- resolver. O `error` é obrigatório exatamente onde ele importa.
ALTER TABLE "lic_webhook_events"
  ADD CONSTRAINT "lic_webhook_events_failure_explained"
  CHECK ("status" <> 'FAILED' OR length(btrim(COALESCE("error", ''))) > 0);

-- ===========================================================================
-- lic_offer_mappings — oferta da plataforma → edição do produto. Raiz de
-- tenancy.
--
-- Sem esta linha a compra NÃO emite licença: vira evento FAILED com o
-- identificador da oferta na mensagem. Adivinhar a edição pelo nome do produto
-- emitiria a licença errada em silêncio — e licença errada entregue por e-mail
-- não se recolhe.
-- ===========================================================================
CREATE TABLE "lic_offer_mappings" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "external_product_id" TEXT NOT NULL,
    -- Nulo = o produto inteiro, qualquer oferta. Preenchido = só aquela oferta.
    -- É como um produto com "anual" e "mensal" aponta para edições diferentes.
    "external_offer_id" TEXT,
    "edition_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lic_offer_mappings_pkey" PRIMARY KEY ("id")
);

-- Duas linhas para a mesma oferta seriam duas edições candidatas para a mesma
-- compra — e a escolha ficaria com o `orderBy` de quem escreveu a query.
--
-- NOTA: em Postgres, NULL não colide com NULL num índice único. O par
-- "produto inteiro" (`external_offer_id IS NULL`) portanto NÃO é protegido por
-- este índice; o índice parcial abaixo cobre esse caso.
CREATE UNIQUE INDEX "lic_offer_mappings_tenant_id_platform_external_product_id_e_key"
  ON "lic_offer_mappings"("tenant_id", "platform", "external_product_id", "external_offer_id");

-- O complemento do índice acima, para a linha curinga do produto. Sem ele,
-- dois mapeamentos "qualquer oferta deste produto" apontando para edições
-- diferentes conviveriam, e a compra emitiria a licença de qualquer uma das
-- duas.
CREATE UNIQUE INDEX "lic_offer_mappings_tenant_platform_product_wildcard_key"
  ON "lic_offer_mappings"("tenant_id", "platform", "external_product_id")
  WHERE "external_offer_id" IS NULL;

ALTER TABLE "lic_offer_mappings"
  ADD CONSTRAINT "lic_offer_mappings_identity_present"
  CHECK (length(btrim("platform")) > 0 AND length(btrim("external_product_id")) > 0
     AND ("external_offer_id" IS NULL OR length(btrim("external_offer_id")) > 0));

-- ===========================================================================
-- mail_deliveries — registro de um e-mail transacional. Raiz de tenancy.
--
-- Existe para que **falha de envio seja visível no admin, não só no log**. O
-- envio é assíncrono e pode falhar depois que a licença já foi emitida — sem
-- esta tabela, "o cliente não recebeu a chave" seria pergunta sem resposta no
-- banco.
--
-- **Não guarda o corpo do e-mail.** A chave em claro passa por aqui a caminho
-- do Resend e não fica: persistir o corpo seria persistir a chave por outro
-- nome, desfazendo a garantia central da SPEC-036.
-- ===========================================================================
CREATE TABLE "mail_deliveries" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "to" TEXT NOT NULL,
    -- O NOME do template (`license_key`, `license_revoked`), não o conteúdo.
    "template" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "status" "MailDeliveryStatus" NOT NULL DEFAULT 'PENDING',
    -- Tentativas do BullMQ até aqui. Distingue "falhou uma vez e o retry
    -- resolve" de "falhou cinco vezes e alguém precisa olhar".
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    -- Para rastrear no painel do Resend quando o cliente diz que não recebeu e
    -- o nosso status diz SENT.
    "provider_message_id" TEXT,
    -- NÃO ESTÁ NA SPEC (desvio registrado no PR): o painel da SPEC-040 responde
    -- "o que aconteceu com este cliente", e sem o vínculo a resposta pararia no
    -- envio sem dizer de qual licença ele era. Nullable porque o módulo `mail`
    -- é compartilhado — o MVP3 vai mandar e-mail sem licença nenhuma por trás.
    "license_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sent_at" TIMESTAMP(3),

    CONSTRAINT "mail_deliveries_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "mail_deliveries_tenant_id_status_created_at_idx"
  ON "mail_deliveries"("tenant_id", "status", "created_at");

ALTER TABLE "mail_deliveries"
  ADD CONSTRAINT "mail_deliveries_identity_present"
  CHECK (length(btrim("to")) > 0 AND length(btrim("template")) > 0
     AND length(btrim("subject")) > 0);

-- SENT sem data de envio é entrega que ninguém sabe quando saiu; data de envio
-- sem SENT é o inverso. O par diz a mesma coisa duas vezes de propósito — é
-- por ele que o admin ordena "o que saiu hoje".
ALTER TABLE "mail_deliveries"
  ADD CONSTRAINT "mail_deliveries_sent_coherent"
  CHECK (("status" = 'SENT') = ("sent_at" IS NOT NULL));

-- Tentativas negativas seriam contador corrompido silencioso.
ALTER TABLE "mail_deliveries"
  ADD CONSTRAINT "mail_deliveries_attempts_not_negative"
  CHECK ("attempts" >= 0);

-- ===========================================================================
-- lic_settings — configuração de venda do tenant. 1:1 com `tenants`.
--
-- **O segredo do webhook não é env var**: ele vive aqui, por tenant. Variável
-- global não escala para o 2º tenant — e o que a torna insuficiente não é
-- conforto, é a decisão #1 do PI: evento assinado com o segredo do tenant A,
-- enviado para a URL do tenant B, tem de responder `401`.
-- ===========================================================================
CREATE TABLE "lic_settings" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "webhook_secret" TEXT NOT NULL,
    -- Dias entre `past_due_at` e o corte (decisão PI #3). **Não é `grace_days`**
    -- — aquele já existe no license file da SPEC-036 e significa tolerância de
    -- heartbeat OFFLINE. Semânticas diferentes, nomes diferentes.
    --
    -- NULL desliga o corte: o ProPlan nunca corta por atraso e quem revoga é
    -- sempre a plataforma. É a mitigação sem deploy do risco aceito — com 15
    -- como padrão, todo tenant herda um segundo julgamento sobre "está pago".
    "past_due_tolerance_days" INTEGER DEFAULT 15,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lic_settings_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "lic_settings_tenant_id_key" ON "lic_settings"("tenant_id");

-- Segredo vazio validaria qualquer assinatura contra a string vazia — o pior
-- resultado possível, porque a rota continuaria respondendo 200 e ninguém
-- notaria que a verificação virou decorativa.
ALTER TABLE "lic_settings"
  ADD CONSTRAINT "lic_settings_webhook_secret_present"
  CHECK (length(btrim("webhook_secret")) > 0);

-- Zero dias de tolerância cortaria no mesmo instante do atraso, o que é
-- exatamente o comportamento que a decisão #3 do PI recusou. Quem quer isso
-- deixa a plataforma revogar. Negativo cortaria retroativamente.
ALTER TABLE "lic_settings"
  ADD CONSTRAINT "lic_settings_tolerance_positive"
  CHECK ("past_due_tolerance_days" IS NULL OR "past_due_tolerance_days" > 0);

-- ===========================================================================
-- Chaves estrangeiras
-- ===========================================================================

ALTER TABLE "lic_webhook_events" ADD CONSTRAINT "lic_webhook_events_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- SetNull e não Cascade: apagar uma licença não pode apagar a prova de que a
-- venda dela chegou.
ALTER TABLE "lic_webhook_events" ADD CONSTRAINT "lic_webhook_events_license_id_fkey"
  FOREIGN KEY ("license_id") REFERENCES "licenses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "lic_offer_mappings" ADD CONSTRAINT "lic_offer_mappings_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Restrict: apagar a edição deixaria o mapeamento apontando para o nada, e a
-- próxima venda falharia sem que ninguém tivesse mudado o mapeamento.
ALTER TABLE "lic_offer_mappings" ADD CONSTRAINT "lic_offer_mappings_edition_id_fkey"
  FOREIGN KEY ("edition_id") REFERENCES "lic_editions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "mail_deliveries" ADD CONSTRAINT "mail_deliveries_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "mail_deliveries" ADD CONSTRAINT "mail_deliveries_license_id_fkey"
  FOREIGN KEY ("license_id") REFERENCES "licenses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "lic_settings" ADD CONSTRAINT "lic_settings_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ===========================================================================
-- RLS (ADR-020, MVP4 decisão 2)
--
-- Mesma policy do resto da casa: `tenant_id = ANY(app.tenant_ids)`. Fail-closed
-- — sem contexto, nenhuma linha. `FORCE` porque o owner da tabela também
-- precisa obedecer.
--
-- As quatro são raízes com `tenant_id` próprio: nenhuma corta por JOIN. Para o
-- `lic_webhook_events` isso é decisão, não conveniência — o evento de oferta
-- não mapeada NÃO tem licença, e cortar por JOIN na licença o deixaria invisível
-- para todo mundo, que é justamente o item que mais precisa aparecer no admin.
-- ===========================================================================

ALTER TABLE "lic_webhook_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "lic_webhook_events" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "lic_webhook_events"
  USING ("tenant_id" = ANY (NULLIF(current_setting('app.tenant_ids', true), '')::text[]));

ALTER TABLE "lic_offer_mappings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "lic_offer_mappings" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "lic_offer_mappings"
  USING ("tenant_id" = ANY (NULLIF(current_setting('app.tenant_ids', true), '')::text[]));

ALTER TABLE "mail_deliveries" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "mail_deliveries" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "mail_deliveries"
  USING ("tenant_id" = ANY (NULLIF(current_setting('app.tenant_ids', true), '')::text[]));

ALTER TABLE "lic_settings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "lic_settings" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "lic_settings"
  USING ("tenant_id" = ANY (NULLIF(current_setting('app.tenant_ids', true), '')::text[]));

-- ===========================================================================
-- resolve_lic_settings — a política de inadimplência do tenant, sem contexto.
--
-- Espelha a `resolve_license` (SPEC-036) e pelo mesmo motivo: `/activate` e
-- `/heartbeat` não têm sessão, rodam sem `app.tenant_ids`, e o RLS fail-closed
-- devolveria vazio para TODO tenant. Sem esta função, a tolerância seria lida
-- como "não configurada" em toda validação — e o corte por inadimplência nunca
-- aconteceria, silenciosamente.
--
-- A saída é UMA COLUNA: os dias de tolerância. **O `webhook_secret` não sai
-- daqui** — ele é lido na rota do webhook, que já sabe o tenant pela URL e roda
-- sob contexto. Uma função com privilégio de owner que devolvesse o segredo
-- daria a qualquer chamador o poder de forjar entrega assinada.
-- ===========================================================================
CREATE OR REPLACE FUNCTION resolve_past_due_tolerance(p_tenant_id text)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT past_due_tolerance_days FROM lic_settings WHERE tenant_id = p_tenant_id LIMIT 1;
$$;

-- A função é o único caminho: `proplan_app` continua sem enxergar a tabela fora
-- de contexto (o RLS não muda). REVOKE de PUBLIC + GRANT explícito.
REVOKE ALL ON FUNCTION resolve_past_due_tolerance(text) FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'proplan_app') THEN
    GRANT EXECUTE ON FUNCTION resolve_past_due_tolerance(text) TO proplan_app;
  END IF;
END $$;
