-- SPEC-033 — Estimativa: decomposição por IA + cálculo determinístico.
--
-- PR-1 da Fatia 22: só o schema. Sem módulo, sem rota, sem cálculo — o que
-- entra aqui é a forma dos dados, porque é a decisão mais cara de desfazer.
--
-- A regra que organiza a fatia inteira, e que este arquivo já reflete: **a IA
-- decompõe, o código calcula** (ADR-012 aplicado a dinheiro). Nenhuma coluna de
-- `estimates` guarda número produzido por um modelo de linguagem. O que a IA
-- produz mora em `artifact_versions` com `kind = 'effort_breakdown'`, sob as
-- mesmas regras de versão e aprovação dos outros quatro artefatos.

-- ===========================================================================
-- `effort_breakdown` — a 5ª capacidade, e o que ela deliberadamente NÃO é.
--
-- Ela entra no enum, mas NÃO em `ARTIFACT_KINDS` / `REQUIRED_ARTIFACT_COUNT`
-- (`artifacts/domain/artifact-kind.ts`), que é o array que gate a transição
-- para `ARTIFACTS_READY`. O motivo é temporal: o `effort_breakdown` só passa a
-- existir DEPOIS desse estado (§2.2 — o botão só aparece com os 4 aprovados).
-- Incluí-lo ali exigiria 5 aprovações para um estado que hoje exige 4, o que
-- quebraria um critério de aceite já aceito da Fatia 21.
-- ===========================================================================
ALTER TYPE "ArtifactKind" ADD VALUE 'effort_breakdown';

-- ===========================================================================
-- Parâmetros de estimativa em `tenant_settings` (§6).
--
-- Reaproveitam a tabela do ADR-026 em vez de criar uma 2ª de configuração: ela
-- já é por tenant e já só o `owner` escreve — que são exatamente as duas regras
-- que a spec pede para estes campos. É também a "2ª configuração por tenant"
-- que o comentário do ADR-026 dava como encomendada, nominalmente para esta
-- spec.
--
-- Os DEFAULTs são os da spec: R$ 200,00/hora e 15% de contingência.
--
-- O câmbio nasce NULL e isso é ESTADO LEGÍTIMO, não "falta preencher": sem taxa
-- informada, o custo de IA aparece em USD, rotulado, e FORA do total em BRL
-- (§2.6). Um DEFAULT aqui seria pior que o NULL — inventaria uma cotação que
-- ninguém digitou e a faria entrar num total que o dono assinaria sem saber.
-- ===========================================================================
ALTER TABLE "tenant_settings"
  ADD COLUMN "hourly_rate_brl"       DECIMAL(12,2) NOT NULL DEFAULT 200,
  ADD COLUMN "contingency_percent"   DECIMAL(5,2)  NOT NULL DEFAULT 15,
  ADD COLUMN "exchange_rate_usd_brl" DECIMAL(12,6),
  ADD COLUMN "exchange_rate_at"      TIMESTAMP(3);

-- Percentual de contingência é percentual: 150 em vez de 15 multiplicaria o
-- orçamento por 2,5 sem que nada falhasse. O CHECK é a única barreira que pega
-- isso independentemente de qual caminho gravou (rota, seed, psql à mão).
ALTER TABLE "tenant_settings"
  ADD CONSTRAINT "tenant_settings_contingency_range"
  CHECK ("contingency_percent" >= 0 AND "contingency_percent" <= 100);

ALTER TABLE "tenant_settings"
  ADD CONSTRAINT "tenant_settings_hourly_rate_positive"
  CHECK ("hourly_rate_brl" > 0);

-- Câmbio, quando informado, é positivo — e vem SEMPRE com a data em que foi
-- digitado (§2.6). Taxa sem data é número sem validade: daqui a três meses
-- ninguém sabe se aquela cotação era de ontem ou do ano passado, e a estimativa
-- continuaria exibindo o total em BRL como se fosse corrente. Os dois campos
-- são um só fato, então o CHECK exige que estejam ambos presentes ou ambos
-- ausentes.
ALTER TABLE "tenant_settings"
  ADD CONSTRAINT "tenant_settings_exchange_rate_pair"
  CHECK (
    ("exchange_rate_usd_brl" IS NULL AND "exchange_rate_at" IS NULL)
    OR ("exchange_rate_usd_brl" IS NOT NULL AND "exchange_rate_at" IS NOT NULL
        AND "exchange_rate_usd_brl" > 0)
  );

-- ===========================================================================
-- estimates — IMUTÁVEL POR VERSÃO. Reestimar cria linha nova (§2.10).
--
-- Raiz de tenancy (`tenant_id` na linha), não filha por JOIN: a rota
-- `POST /t/:tenant/estimates/:id/approve` busca DIRETO POR `id`, e
-- `client_projects` é neta de `clients` — a policy viraria JOIN de três níveis
-- no caminho de uma escrita que move card. Mesmo precedente das três tabelas do
-- pipeline (SPEC-032) e do `file_assets` (ADR-025).
--
-- Os parâmetros são COPIADOS para a linha, não lidos por relação com
-- `tenant_settings`. Snapshot e não referência porque uma estimativa vira
-- proposta enviada ao cliente: se ela se recalculasse sozinha quando alguém
-- editasse o valor/hora do tenant, o número em tela deixaria de ser o número
-- que o cliente recebeu — e ninguém perceberia, porque nada falharia.
-- ===========================================================================
CREATE TABLE "estimates" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "client_project_id" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    -- De qual decomposição este número saiu. Sem esta coluna, responder isso
    -- vira arqueologia por timestamp.
    "effort_version_id" TEXT NOT NULL,

    -- Snapshot dos parâmetros no instante do cálculo.
    "hourly_rate_brl" DECIMAL(12,2) NOT NULL,
    "contingency_percent" DECIMAL(5,2) NOT NULL,
    -- Nível vindo de `BriefingVersion.answers['9'].complexity`
    -- ('baixa'|'media'|'alta', sem acento) e o multiplicador que ele produziu
    -- (0,85 / 1,00 / 1,30 — §2.3). O FATOR é gravado além do NÍVEL de
    -- propósito: a tabela de multiplicadores pode ser revista, e a conta desta
    -- linha não pode mudar retroativamente com ela.
    "complexity" TEXT NOT NULL,
    "complexity_factor" DECIMAL(5,4) NOT NULL,
    "exchange_rate" DECIMAL(12,6),
    "exchange_rate_at" TIMESTAMP(3),

    -- `{label, valueBrl}[]` — digitação livre nesta fatia (§2.7), sem catálogo.
    "direct_costs" JSONB NOT NULL,
    -- FATO: soma do ledger (`llm_usage.cost_usd` via `artifact_run_id`) no
    -- instante de gerar. NUNCA derivado de `artifact_versions` — é literalmente
    -- o que o ADR-016 proíbe.
    "ai_cost_incurred_usd" DECIMAL(12,8) NOT NULL,
    -- PROJEÇÃO: `{valueUsd, isCalculated}`. `isCalculated=false` quando o
    -- tenant tem <3 runs concluídos e o valor foi digitado à mão. Leva o rótulo
    -- "projeção" nos DOIS casos (§2.8): projeção calculada continua projeção, e
    -- exibi-la com a confiança de um número medido é exatamente o erro que o
    -- rótulo existe para impedir.
    "ai_cost_projected" JSONB NOT NULL,

    -- `{otimista, provavel, pessimista}`, cada um com horas, subtotal,
    -- contingência e total — cada número mostrando a sua conta (§1). A
    -- contingência é linha própria DENTRO de cada cenário, nunca embutida no
    -- valor/hora nem somada ao total sem discriminação (§2.5).
    "scenarios" JSONB NOT NULL,
    -- Agrupamento em MVP1/MVP2/… com subtotal de horas e custo (§2.9). SÓ DADO:
    -- este caminho não fala com o GitHub. Criar issues reais mudaria a fronteira
    -- declarada no MVP3 §3 e pede ADR próprio (§3).
    "mvp_breakdown" JSONB NOT NULL,

    -- Aprovar move o card `ARTIFACTS_READY → CONTRACT_PENDING` (§2.11). É o
    -- ÚNICO "aprovar" desta fatia que move o card — o do `effort_breakdown` é
    -- aprovação de artefato comum e não move nada (§7.1).
    "approved_at" TIMESTAMP(3),
    "approved_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT,

    CONSTRAINT "estimates_pkey" PRIMARY KEY ("id")
);

-- Versão sequencial por projeto. É o unique que transforma "reestimar cria
-- linha nova" numa garantia do banco em vez de uma intenção do service: duas
-- gerações simultâneas colidem aqui em vez de gravarem duas v3.
CREATE UNIQUE INDEX "estimates_client_project_id_version_key"
  ON "estimates"("client_project_id", "version");
CREATE INDEX "estimates_client_project_id_created_at_idx"
  ON "estimates"("client_project_id", "created_at");
CREATE INDEX "estimates_tenant_id_created_at_idx"
  ON "estimates"("tenant_id", "created_at");

-- Aprovação é um par: quem e quando. Uma linha com `approved_at` e sem
-- `approved_by` seria uma estimativa aprovada por ninguém — e o §2.11 exige
-- ator NUNCA nulo justamente porque este é o ato que move o card para
-- `CONTRACT_PENDING`. O CHECK vale para qualquer caminho de escrita, inclusive
-- um UPDATE feito à mão no psql.
ALTER TABLE "estimates"
  ADD CONSTRAINT "estimates_approval_pair"
  CHECK (
    ("approved_at" IS NULL AND "approved_by" IS NULL)
    OR ("approved_at" IS NOT NULL AND "approved_by" IS NOT NULL)
  );

-- As mesmas barreiras de faixa do `tenant_settings`, repetidas aqui de
-- propósito. A linha de `estimates` é SNAPSHOT, não referência: ela não herda
-- nenhum CHECK da origem, e um valor absurdo pode entrar por um caminho que
-- nunca passou pela tela de parâmetros (cálculo, seed, UPDATE à mão). Onde o
-- número vira proposta enviada ao cliente, a barreira precisa estar na tabela
-- que o guarda.
--
-- `150` no lugar de `15` multiplicaria o orçamento por 2,5 e nada falharia: o
-- total sairia maior e pareceria deliberado.
ALTER TABLE "estimates"
  ADD CONSTRAINT "estimates_contingency_range"
  CHECK ("contingency_percent" >= 0 AND "contingency_percent" <= 100);

-- Valor/hora zero produziria um orçamento de R$ 0,00 com aparência de conta
-- feita — o pior formato possível de erro num número que vira proposta.
ALTER TABLE "estimates"
  ADD CONSTRAINT "estimates_hourly_rate_positive"
  CHECK ("hourly_rate_brl" > 0);

-- O multiplicador do grau de acabamento é fator, não percentual: 0 zeraria as
-- horas e um negativo produziria orçamento negativo. Nenhum dos dois tem
-- leitura possível numa proposta.
ALTER TABLE "estimates"
  ADD CONSTRAINT "estimates_complexity_factor_positive"
  CHECK ("complexity_factor" > 0);

-- Mesmo par para o câmbio da linha, pelo mesmo motivo do `tenant_settings`:
-- taxa sem data é número sem validade.
ALTER TABLE "estimates"
  ADD CONSTRAINT "estimates_exchange_rate_pair"
  CHECK (
    ("exchange_rate" IS NULL AND "exchange_rate_at" IS NULL)
    OR ("exchange_rate" IS NOT NULL AND "exchange_rate_at" IS NOT NULL
        AND "exchange_rate" > 0)
  );

-- ===========================================================================
-- Chaves estrangeiras
-- ===========================================================================
ALTER TABLE "estimates" ADD CONSTRAINT "estimates_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "estimates" ADD CONSTRAINT "estimates_client_project_id_fkey"
  FOREIGN KEY ("client_project_id") REFERENCES "client_projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RESTRICT, e não CASCADE nem SET NULL: a versão do `effort_breakdown` é a
-- CONTA que explica o número. Apagá-la com CASCADE levaria junto a estimativa
-- que o cliente já recebeu; com SET NULL, deixaria o número órfão da
-- decomposição que o produziu — reproduzível deixa de ser reproduzível. Se
-- alguém precisar mesmo apagar, que o banco recuse e a decisão seja consciente.
ALTER TABLE "estimates" ADD CONSTRAINT "estimates_effort_version_id_fkey"
  FOREIGN KEY ("effort_version_id") REFERENCES "artifact_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ===========================================================================
-- RLS — mesmo desenho das demais raízes (ADR-020).
--
-- FORCE: sem ele o Postgres pula a policy para o OWNER da tabela.
-- Fail-closed: sem `app.tenant_ids`, `NULLIF(...,'')` vira NULL, `= ANY(NULL)`
-- é NULL, e nenhuma linha sai.
--
-- A armadilha que esta fatia herda, e que já custou 5 ocorrências nesta frente:
-- o job de geração do `effort_breakdown` NÃO TEM REQUEST. Ler ou gravar sem
-- `runInTenantContext` não dá erro — dá ZERO LINHAS, e uma geração que gravou
-- zero tem a mesma cara de uma bem-sucedida vista de fora. Vale para o PR-2.
-- ===========================================================================
ALTER TABLE "estimates" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "estimates" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "estimates"
  USING ("tenant_id" = ANY (NULLIF(current_setting('app.tenant_ids', true), '')::text[]));
