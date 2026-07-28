-- SPEC-034 — Contratos: perfil, templates versionados, snapshot imutável e
-- link público.
--
-- PR-1 da Fatia 23: só o schema. Sem módulo, sem rota, sem renderização — o que
-- entra aqui é a forma dos dados, porque é a decisão mais cara de desfazer.
--
-- A regra que organiza a fatia inteira, e que este arquivo já reflete: **o
-- contrato é snapshot, não referência**. Um contrato é o documento que o
-- cliente recebeu; se ele lesse o cliente, o escopo ou a estimativa por FK,
-- corrigir qualquer um deles meses depois mudaria em silêncio o que está
-- escrito num documento já enviado — e nada falharia.

-- ===========================================================================
-- Enums
-- ===========================================================================

-- Lista FECHADA (§8.3, decisão 3 do PI). Canal em texto livre viraria um campo
-- que ninguém consegue agrupar depois, e a pergunta que ele existe para
-- responder ("por onde os clientes aceitam?") deixaria de ter resposta.
CREATE TYPE "AcceptanceChannel" AS ENUM ('email', 'whatsapp', 'presencial', 'telefone');

-- Um template por modalidade (§2.2), sem seção condicional dentro de texto
-- jurídico — decisão do PI em #149. As três são as do MVP3 §3.
CREATE TYPE "ContractModality" AS ENUM (
  'desenvolvimento',
  'desenvolvimento_manutencao',
  'desenvolvimento_venda_codigo'
);

-- ===========================================================================
-- provider_profiles — os dados do prestador, UM por tenant (§2.1).
--
-- Raiz de tenancy com `tenant_id` UNIQUE: dois perfis significaria que a
-- emissão do contrato precisaria escolher um, e nada diria qual.
-- ===========================================================================
CREATE TABLE "provider_profiles" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "legal_name" TEXT NOT NULL,
    -- 'cpf' | 'cnpj'. TEXT com CHECK e não enum: o par tipo+documento é
    -- validado junto (abaixo), e um enum aqui só adicionaria um tipo novo ao
    -- banco sem tornar a regra mais forte.
    "document_type" TEXT NOT NULL,
    "document" TEXT NOT NULL,
    "zip_code" TEXT,
    "street" TEXT,
    "district" TEXT,
    "city" TEXT,
    "state" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "provider_profiles_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "provider_profiles_tenant_id_key" ON "provider_profiles"("tenant_id");

-- O tipo do documento decide como ele é lido no contrato ("CPF nº ..." vs
-- "CNPJ nº ..."). Um valor fora dos dois produziria um contrato com rótulo
-- errado no dado que identifica a parte — e nada falharia ao gravar.
ALTER TABLE "provider_profiles"
  ADD CONSTRAINT "provider_profiles_document_type_valid"
  CHECK ("document_type" IN ('cpf', 'cnpj'));

-- Prestador sem nome ou sem documento produz um contrato em que uma das partes
-- não está identificada. O CHECK barra a string vazia, que é o que passa por
-- NOT NULL sem dizer nada.
ALTER TABLE "provider_profiles"
  ADD CONSTRAINT "provider_profiles_identity_present"
  CHECK (length(btrim("legal_name")) > 0 AND length(btrim("document")) > 0);

-- ===========================================================================
-- contract_templates + contract_template_versions
--
-- O template é o PONTEIRO; o texto vive nas versões, que são imutáveis. Editar
-- cria versão nova e a anterior continua legível — porque um contrato emitido
-- aponta para ela e precisa continuar explicando de que texto saiu.
-- ===========================================================================
CREATE TABLE "contract_templates" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "modality" "ContractModality" NOT NULL,
    -- Nullable apenas entre o INSERT do template e o da 1ª versão, que o seed
    -- grava na mesma transação. Fora dessa janela, sempre preenchido.
    "current_version_id" TEXT,
    -- `true` enquanto o texto é o semeado. Vira `false` na 1ª versão salva pelo
    -- prestador, e é ISTO que a trava do §2.3 consulta: o produto não emite
    -- contrato com texto que o dono nunca leu.
    "is_seed_example" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contract_templates_pkey" PRIMARY KEY ("id")
);

-- Um template por modalidade, por tenant (§2.2). É o unique que transforma a
-- regra numa garantia do banco em vez de uma intenção do service.
CREATE UNIQUE INDEX "contract_templates_tenant_id_modality_key"
  ON "contract_templates"("tenant_id", "modality");
CREATE UNIQUE INDEX "contract_templates_current_version_id_key"
  ON "contract_templates"("current_version_id");

CREATE TABLE "contract_template_versions" (
    "id" TEXT NOT NULL,
    "template_id" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    -- Texto com placeholders `{{...}}`. A substituição é ESCAPADA na
    -- renderização (§2.4) — nunca engine que avalie expressão, que é como um
    -- template vira execução de código a partir de dado do cliente.
    "body" TEXT NOT NULL,
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contract_template_versions_pkey" PRIMARY KEY ("id")
);

-- Versão sequencial por template. Duas gravações simultâneas colidem aqui em
-- vez de produzirem duas v2.
CREATE UNIQUE INDEX "contract_template_versions_template_id_version_key"
  ON "contract_template_versions"("template_id", "version");

-- Corpo vazio geraria um contrato em branco com aparência de contrato emitido.
ALTER TABLE "contract_template_versions"
  ADD CONSTRAINT "contract_template_versions_body_present"
  CHECK (length(btrim("body")) > 0);

-- ===========================================================================
-- contracts — SNAPSHOT IMUTÁVEL (§2.5).
--
-- Raiz de tenancy pelo mesmo critério do `estimates` e do `file_assets`
-- (ADR-025): as rotas de link e de aceite buscam DIRETO POR `id`, e
-- `client_projects` é neta de `clients` — a policy viraria JOIN de três níveis
-- no caminho de uma escrita que move card.
--
-- As colunas `*_snapshot` são CÓPIA, não relação. As FKs que sobram
-- (`estimate_id`, `template_version_id`) existem para responder "de onde este
-- número saiu?", não para alimentar o texto.
-- ===========================================================================
CREATE TABLE "contracts" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "client_project_id" TEXT NOT NULL,
    -- Refazer o contrato emite v2; a v1 permanece legível (§2.5).
    "version" INTEGER NOT NULL,
    "modality" "ContractModality" NOT NULL,
    "estimate_id" TEXT NOT NULL,
    "template_version_id" TEXT NOT NULL,

    -- HTML final, já renderizado e escapado, com o disclaimer no rodapé
    -- (§2.12). É o que a rota pública serve: renderizar de novo na leitura
    -- permitiria que uma mudança no renderizador alterasse, meses depois, um
    -- documento já entregue ao cliente.
    "rendered_html" TEXT NOT NULL,
    "provider_snapshot" JSONB NOT NULL,
    "client_snapshot" JSONB NOT NULL,
    "scope_snapshot" JSONB NOT NULL,
    -- Do cenário PROVÁVEL da `Estimate` aprovada (§6) — a spec fixa qual dos
    -- três em voz alta: prometer o otimista seria o erro caro, e o pessimista
    -- perderia venda. DECIMAL e não FLOAT: é o mesmo dinheiro do `Estimate`, e
    -- o contrato tem de imprimir exatamente o que ela congelou (ADR-016).
    "budget_brl" DECIMAL(12,2) NOT NULL,
    -- HORAS, não dias (§8.7): o `Estimate` implementado não produz duração em
    -- dias, e nenhuma fatia do MVP3 produz o divisor de horas produtivas/dia.
    "effort_hours" DECIMAL(12,2) NOT NULL,
    "payment_terms" TEXT,

    -- Aceite (§2.10): registrado pelo PRESTADOR no painel, nunca pelo cliente
    -- na rota pública. Não é assinatura eletrônica, e a UI não deve sugerir que
    -- seja (§3).
    "accepted_at" TIMESTAMP(3),
    "accepted_by" TEXT,
    "acceptance_channel" "AcceptanceChannel",
    "acceptance_note" TEXT,

    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT,

    CONSTRAINT "contracts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "contracts_client_project_id_version_key"
  ON "contracts"("client_project_id", "version");
CREATE INDEX "contracts_client_project_id_created_at_idx"
  ON "contracts"("client_project_id", "created_at");
CREATE INDEX "contracts_tenant_id_created_at_idx"
  ON "contracts"("tenant_id", "created_at");

-- O aceite é um TRIO: quem, quando e por onde. É o ato que move o card para
-- `CONTRACT_APPROVED`, e o §2.10 exige ator nunca nulo — um contrato "aceito
-- por ninguém" seria exatamente o fechamento frágil que este produto existe
-- para detectar. `acceptance_note` fica de fora do trio de propósito: é
-- observação livre e opcional.
ALTER TABLE "contracts"
  ADD CONSTRAINT "contracts_acceptance_triple"
  CHECK (
    ("accepted_at" IS NULL AND "accepted_by" IS NULL AND "acceptance_channel" IS NULL)
    OR ("accepted_at" IS NOT NULL AND "accepted_by" IS NOT NULL
        AND "acceptance_channel" IS NOT NULL)
  );

-- Valor zero ou negativo produziria uma proposta de R$ 0,00 COM APARÊNCIA de
-- conta feita — o pior formato possível de erro num número que vai ao cliente
-- dentro de um documento que ele pode tratar como vinculante. Mesmo motivo do
-- `estimates_hourly_rate_positive`, e repetido aqui porque snapshot não herda
-- CHECK da origem.
ALTER TABLE "contracts"
  ADD CONSTRAINT "contracts_budget_positive"
  CHECK ("budget_brl" > 0);

ALTER TABLE "contracts"
  ADD CONSTRAINT "contracts_effort_hours_positive"
  CHECK ("effort_hours" > 0);

-- Contrato sem corpo renderizado é um documento em branco que a rota pública
-- serviria como se fosse o contrato.
ALTER TABLE "contracts"
  ADD CONSTRAINT "contracts_rendered_html_present"
  CHECK (length(btrim("rendered_html")) > 0);

-- ===========================================================================
-- contract_links — 2º link público do produto (§7.2).
--
-- Mesmo desenho do `briefing_links`: token de 256 bits exibido UMA ÚNICA VEZ,
-- só o hash SHA-256 persiste. Um vazamento do banco não entrega nenhum link.
--
-- A diferença que importa: aqui o link expõe CPF/CNPJ e endereço das DUAS
-- partes (§2.7), então `expires_at` é NOT NULL e nasce em agora + 48 h (§2.8).
-- No briefing a expiração é opcional; aqui, link sem prazo seria dado pessoal
-- legível para sempre por quem tiver a URL.
-- ===========================================================================
CREATE TABLE "contract_links" (
    "id" TEXT NOT NULL,
    "contract_id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "revoked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT,

    CONSTRAINT "contract_links_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "contract_links_token_hash_key" ON "contract_links"("token_hash");
CREATE INDEX "contract_links_contract_id_idx" ON "contract_links"("contract_id");

-- Um link que expira antes de nascer é um link morto que a tela mostraria como
-- recém-criado. Barra o erro de sinal no cálculo das 48 h.
ALTER TABLE "contract_links"
  ADD CONSTRAINT "contract_links_expires_after_creation"
  CHECK ("expires_at" > "created_at");

-- ===========================================================================
-- Chaves estrangeiras
-- ===========================================================================
ALTER TABLE "provider_profiles" ADD CONSTRAINT "provider_profiles_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "contract_templates" ADD CONSTRAINT "contract_templates_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- SET NULL e não CASCADE: apagar a versão corrente não pode levar junto o
-- template (e com ele o histórico de versões). O ponteiro fica nulo e o service
-- reaponta.
ALTER TABLE "contract_templates" ADD CONSTRAINT "contract_templates_current_version_id_fkey"
  FOREIGN KEY ("current_version_id") REFERENCES "contract_template_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "contract_template_versions" ADD CONSTRAINT "contract_template_versions_template_id_fkey"
  FOREIGN KEY ("template_id") REFERENCES "contract_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "contracts" ADD CONSTRAINT "contracts_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_client_project_id_fkey"
  FOREIGN KEY ("client_project_id") REFERENCES "client_projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RESTRICT nos dois, mesmo padrão de `estimates_effort_version_id_fkey`: a
-- estimativa é a CONTA que explica o valor do contrato, e a versão do template
-- é o TEXTO de que ele saiu. `CASCADE` levaria junto um contrato já enviado ao
-- cliente; `SET NULL` deixaria o documento órfão da sua origem — auditável
-- deixaria de ser auditável. Se alguém precisar mesmo apagar, que o banco
-- recuse e a decisão seja consciente.
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_estimate_id_fkey"
  FOREIGN KEY ("estimate_id") REFERENCES "estimates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_template_version_id_fkey"
  FOREIGN KEY ("template_version_id") REFERENCES "contract_template_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "contract_links" ADD CONSTRAINT "contract_links_contract_id_fkey"
  FOREIGN KEY ("contract_id") REFERENCES "contracts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ===========================================================================
-- RLS — mesmo desenho das demais raízes (ADR-020).
--
-- FORCE: sem ele o Postgres pula a policy para o OWNER da tabela.
-- Fail-closed: sem `app.tenant_ids`, `NULLIF(...,'')` vira NULL, `= ANY(NULL)`
-- é NULL, e nenhuma linha sai.
--
-- A armadilha que esta fatia herda, e que já custou CINCO ocorrências nesta
-- frente: a rota pública `GET /c/:token` NÃO TEM SESSÃO. Ler sem
-- `runInTenantContext` não dá erro — dá ZERO LINHAS, e todo token válido
-- responderia "inválido". É exatamente por isso que existe a
-- `resolve_contract_link` no fim deste arquivo, e por que o teste de
-- fail-closed dela vem ANTES do controller (§7.2, item 5).
--
-- As duas filhas por JOIN (`contract_template_versions` e `contract_links`)
-- herdam o corte da raiz: nunca são buscadas sozinhas por `id` fora do
-- contexto do pai.
-- ===========================================================================
ALTER TABLE "provider_profiles" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "provider_profiles" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "provider_profiles"
  USING ("tenant_id" = ANY (NULLIF(current_setting('app.tenant_ids', true), '')::text[]));

ALTER TABLE "contract_templates" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "contract_templates" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "contract_templates"
  USING ("tenant_id" = ANY (NULLIF(current_setting('app.tenant_ids', true), '')::text[]));

ALTER TABLE "contracts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "contracts" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "contracts"
  USING ("tenant_id" = ANY (NULLIF(current_setting('app.tenant_ids', true), '')::text[]));

-- Filha por JOIN: o corte vem do template dono.
ALTER TABLE "contract_template_versions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "contract_template_versions" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "contract_template_versions"
  USING (EXISTS (
    SELECT 1 FROM "contract_templates" ct
    WHERE ct."id" = "contract_template_versions"."template_id"
      AND ct."tenant_id" = ANY (NULLIF(current_setting('app.tenant_ids', true), '')::text[])
  ));

-- Filha por JOIN: o corte vem do contrato dono.
ALTER TABLE "contract_links" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "contract_links" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "contract_links"
  USING (EXISTS (
    SELECT 1 FROM "contracts" c
    WHERE c."id" = "contract_links"."contract_id"
      AND c."tenant_id" = ANY (NULLIF(current_setting('app.tenant_ids', true), '')::text[])
  ));

-- ===========================================================================
-- resolve_contract_link — o lookup público, sem contexto de tenant.
--
-- Espelha a `resolve_briefing_link` (SPEC-029) porque o problema é o mesmo:
-- `GET /c/:token` não tem sessão, então roda sem `app.tenant_ids`, e o RLS
-- fail-closed devolveria vazio para TODO token — inclusive os válidos.
--
-- Superfície mínima e auditável:
--   - recebe UM argumento: o hash (SHA-256 hex de um token de 256 bits);
--   - devolve as colunas de ciclo de vida do link + o contrato + o tenant;
--   - não aceita filtro livre, não lista, não pagina — não há como enumerar;
--   - o RLS continua ATIVO em todas as tabelas para todo o resto.
--
-- Por que não uma policy `USING (true)`: abriria a tabela inteira para
-- qualquer query sem contexto. Por que não uma role com BYPASSRLS: o ADR-022
-- proíbe (o bootstrap FALHA se a role tiver `rolbypassrls`).
--
-- `search_path` fixo é obrigatório em SECURITY DEFINER: sem ele, um caller
-- poderia apontar `contracts` para uma tabela própria e a função executaria com
-- privilégio de owner sobre ela.
--
-- O `rendered_html` NÃO sai daqui de propósito: esta função responde "este
-- token serve, e para qual contrato?". O documento é lido depois, já sob o
-- contexto do tenant que ela devolveu — assim o RLS continua sendo o que
-- protege o conteúdo, e não a lista de colunas de uma função privilegiada.
-- ===========================================================================
CREATE OR REPLACE FUNCTION resolve_contract_link(p_token_hash text)
RETURNS TABLE (
  id text,
  expires_at timestamp(3),
  revoked_at timestamp(3),
  tenant_id text,
  contract_id text,
  client_project_id text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT cl.id, cl.expires_at, cl.revoked_at, c.tenant_id, cl.contract_id,
         c.client_project_id
  FROM contract_links cl
  JOIN contracts c ON c.id = cl.contract_id
  JOIN client_projects cp ON cp.id = c.client_project_id
  JOIN clients cli ON cli.id = cp.client_id
  WHERE cl.token_hash = p_token_hash
    AND cp.deleted_at IS NULL
    AND cli.deleted_at IS NULL
  LIMIT 1;
$$;

-- A função é o único caminho: `proplan_app` continua sem enxergar as tabelas
-- fora de contexto (o RLS não muda). REVOKE de PUBLIC + GRANT explícito para
-- que só a role da aplicação possa chamá-la.
REVOKE ALL ON FUNCTION resolve_contract_link(text) FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'proplan_app') THEN
    GRANT EXECUTE ON FUNCTION resolve_contract_link(text) TO proplan_app;
  END IF;
END $$;
