-- SPEC-032 — Pipeline de IA: artefatos versionados com aprovação humana.
--
-- PR-1 da Fatia 21: só o schema. Sem módulo, sem job, sem rota — o que entra
-- aqui é a forma dos dados, porque é a decisão mais cara de desfazer depois.
--
-- Três das quatro tabelas são RAÍZES de tenancy (`tenant_id` na linha), não
-- filhas por JOIN. O precedente é o `FileAsset` (ADR-025): as rotas do §6
-- buscam artefato, versão e run DIRETO POR `id`, e `client_projects` é neta de
-- `clients` — a policy viraria um JOIN de três níveis no caminho de toda
-- leitura. Policy que ninguém relê é policy que ninguém audita.
-- `review_verdicts` fica de fora dessa regra de propósito: nunca é buscada por
-- `id` solto, sempre junto da versão, então herda o corte por JOIN.

CREATE TYPE "ArtifactKind" AS ENUM ('normalize', 'scope', 'requirements', 'site_prompt');
CREATE TYPE "ArtifactState" AS ENUM ('PENDING_REVIEW', 'APPROVED', 'REJECTED', 'FAILED');
CREATE TYPE "ArtifactAuthor" AS ENUM ('ai', 'human');
CREATE TYPE "ArtifactRunStatus" AS ENUM ('RUNNING', 'COMPLETED', 'FAILED');

-- ===========================================================================
-- artifacts — um por (client_project, kind). O conteúdo mora nas versões.
-- ===========================================================================
CREATE TABLE "artifacts" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "client_project_id" TEXT NOT NULL,
    "kind" "ArtifactKind" NOT NULL,
    "state" "ArtifactState" NOT NULL DEFAULT 'PENDING_REVIEW',
    "current_version_id" TEXT,
    "rejection_reason" TEXT,
    "reviewed_at" TIMESTAMP(3),
    "reviewed_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "artifacts_pkey" PRIMARY KEY ("id")
);

-- Um artefato por tipo, por projeto. É isto que torna "os 4 aprovados" (§2.7)
-- uma contagem confiável: sem o UNIQUE, um retry criaria o 5º `scope` e a
-- regra de mover o card passaria a contar linhas duplicadas. As tentativas
-- viram VERSÕES, nunca linhas novas aqui.
CREATE UNIQUE INDEX "artifacts_client_project_id_kind_key"
  ON "artifacts"("client_project_id", "kind");
CREATE INDEX "artifacts_tenant_id_created_at_idx" ON "artifacts"("tenant_id", "created_at");

-- ===========================================================================
-- artifact_versions — IMUTÁVEL. Editar cria versão; nunca reescreve.
-- ===========================================================================
CREATE TABLE "artifact_versions" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "artifact_id" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "content" JSONB NOT NULL,
    "author" "ArtifactAuthor" NOT NULL,
    "parent_version_id" TEXT,
    "input_hash" TEXT,
    "prompt_version" TEXT,
    "model" TEXT,
    "edited_by" TEXT,
    "artifact_run_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "artifact_versions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "artifact_versions_artifact_id_version_key"
  ON "artifact_versions"("artifact_id", "version");

-- ===========================================================================
-- O índice PARCIAL — a decisão mais delicada do PR (§7.4.2).
--
-- O único de idempotência é (artifact_id, input_hash) APENAS quando a autora é
-- a IA. Duas razões para o `WHERE`, e nenhuma é estética:
--
-- 1. Versão humana não tem insumo para hashear. Sem o `WHERE`, ou se inventa um
--    hash para texto escrito à mão — hash que não hasheia nada é mentira com
--    cara de chave — ou se deixa NULL e o índice deixa de significar o que diz.
-- 2. O `WHERE` é o que mantém o único ESTREITO. Sem ele o índice cobriria
--    linhas cujo `input_hash` é NULL, e no Postgres NULLs não colidem entre si
--    — o índice existiria dando a impressão de proteger a idempotência das
--    versões humanas, que ele nunca protegeu.
--
-- O que ele NÃO faz: barrar o botão "regenerar". A decisão 3 do PI (§2.11) diz
-- que regenerar SEMPRE cria versão nova, mesmo com entrada idêntica — o
-- `version` sequencial é que distingue as duas linhas, e o hash repetido entre
-- versões diferentes é esperado. Por isso o único é (artifact_id, input_hash) e
-- não inclui `version`: ele protege o GATILHO AUTOMÁTICO (§2.8) de gravar duas
-- vezes o mesmo artefato quando o job roda duas vezes para a mesma
-- BriefingVersion.
--
-- Consequência aceita: um regenerate manual com insumo idêntico é recusado por
-- este índice, e o service precisa tratá-lo — não deixar estourar como 500. O
-- PR-4, que implementa o botão, é quem paga essa conta.
-- ===========================================================================
CREATE UNIQUE INDEX "artifact_versions_ai_input_hash_key"
  ON "artifact_versions"("artifact_id", "input_hash")
  WHERE "author" = 'ai';

CREATE INDEX "artifact_versions_artifact_id_created_at_idx"
  ON "artifact_versions"("artifact_id", "created_at");
CREATE INDEX "artifact_versions_tenant_id_created_at_idx"
  ON "artifact_versions"("tenant_id", "created_at");

-- ===========================================================================
-- artifact_runs — execução do pipeline. O CUSTO NÃO MORA AQUI (ADR-016).
-- ===========================================================================
CREATE TABLE "artifact_runs" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "client_project_id" TEXT NOT NULL,
    "briefing_version_id" TEXT NOT NULL,
    "status" "ArtifactRunStatus" NOT NULL DEFAULT 'RUNNING',
    "completed_kinds" "ArtifactKind"[],
    "attempts" INTEGER NOT NULL DEFAULT 1,
    "failure_reason" TEXT,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMP(3),

    CONSTRAINT "artifact_runs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "artifact_runs_client_project_id_started_at_idx"
  ON "artifact_runs"("client_project_id", "started_at");
CREATE INDEX "artifact_runs_briefing_version_id_idx"
  ON "artifact_runs"("briefing_version_id");
CREATE INDEX "artifact_runs_tenant_id_started_at_idx"
  ON "artifact_runs"("tenant_id", "started_at");

-- ===========================================================================
-- review_verdicts — parecer do revisor. ANOTA, NUNCA BLOQUEIA (§2.9).
--
-- `verdict` é TEXT livre, não enum, de propósito: um enum com valor 'reject'
-- seria um convite a alguém escrever `WHERE verdict <> 'reject'` no caminho da
-- aprovação — que é exatamente o poder de veto que a decisão 1 do PI recusa.
-- ===========================================================================
CREATE TABLE "review_verdicts" (
    "id" TEXT NOT NULL,
    "artifact_version_id" TEXT NOT NULL,
    "verdict" TEXT NOT NULL,
    "rationale" TEXT NOT NULL,
    "prompt_version" TEXT,
    "model" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "review_verdicts_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "review_verdicts_artifact_version_id_idx"
  ON "review_verdicts"("artifact_version_id");

-- ===========================================================================
-- llm_usage.artifact_run_id — o que faz "quanto custou este briefing" ser
-- CONSULTA AO LEDGER (§5). Derivar o custo de `artifact_versions` é o que o
-- ADR-016 proíbe: o ledger é a fonte, o artefato é o produto.
--
-- Sem FK forte, no mesmo espírito de `llm_usage.tenant_id`: o ledger é
-- append-only e sobrevive ao que o originou. Um run apagado não pode levar
-- junto o registro de dinheiro que já foi gasto.
-- ===========================================================================
ALTER TABLE "llm_usage" ADD COLUMN "artifact_run_id" TEXT;
CREATE INDEX "llm_usage_artifact_run_id_idx" ON "llm_usage"("artifact_run_id");

-- ===========================================================================
-- Chaves estrangeiras
-- ===========================================================================
ALTER TABLE "artifacts" ADD CONSTRAINT "artifacts_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "artifacts" ADD CONSTRAINT "artifacts_client_project_id_fkey"
  FOREIGN KEY ("client_project_id") REFERENCES "client_projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "artifact_versions" ADD CONSTRAINT "artifact_versions_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "artifact_versions" ADD CONSTRAINT "artifact_versions_artifact_id_fkey"
  FOREIGN KEY ("artifact_id") REFERENCES "artifacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- SET NULL, não CASCADE: apagar a versão-pai não pode apagar a edição humana
-- que derivou dela. A linhagem perde o elo; o trabalho do dono, não.
ALTER TABLE "artifact_versions" ADD CONSTRAINT "artifact_versions_parent_version_id_fkey"
  FOREIGN KEY ("parent_version_id") REFERENCES "artifact_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "artifact_versions" ADD CONSTRAINT "artifact_versions_artifact_run_id_fkey"
  FOREIGN KEY ("artifact_run_id") REFERENCES "artifact_runs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "artifact_runs" ADD CONSTRAINT "artifact_runs_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "artifact_runs" ADD CONSTRAINT "artifact_runs_client_project_id_fkey"
  FOREIGN KEY ("client_project_id") REFERENCES "client_projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "artifact_runs" ADD CONSTRAINT "artifact_runs_briefing_version_id_fkey"
  FOREIGN KEY ("briefing_version_id") REFERENCES "briefing_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "review_verdicts" ADD CONSTRAINT "review_verdicts_artifact_version_id_fkey"
  FOREIGN KEY ("artifact_version_id") REFERENCES "artifact_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ===========================================================================
-- RLS — mesmo desenho das demais raízes (ADR-020).
--
-- FORCE: sem ele o Postgres pula a policy para o OWNER da tabela.
-- Fail-closed: sem `app.tenant_ids`, `NULLIF(...,'')` vira NULL, `= ANY(NULL)`
-- é NULL, e nenhuma linha sai.
--
-- O que isto cobra do PR-2, e vale dizer aqui porque é onde a armadilha mora:
-- o job do pipeline NÃO TEM REQUEST. Ler ou gravar sem `runInTenantContext`
-- não dá erro — dá ZERO LINHAS. Um pipeline que "rodou" e gravou zero
-- artefatos tem exatamente a mesma cara de um pipeline bem-sucedido, do lado
-- de fora. Esta frente já acumulou 5 ocorrências desta classe, todas com a
-- suíte verde; duas só apareceram no dogfooding.
-- ===========================================================================
ALTER TABLE "artifacts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "artifacts" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "artifacts"
  USING ("tenant_id" = ANY (NULLIF(current_setting('app.tenant_ids', true), '')::text[]));

ALTER TABLE "artifact_versions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "artifact_versions" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "artifact_versions"
  USING ("tenant_id" = ANY (NULLIF(current_setting('app.tenant_ids', true), '')::text[]));

ALTER TABLE "artifact_runs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "artifact_runs" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "artifact_runs"
  USING ("tenant_id" = ANY (NULLIF(current_setting('app.tenant_ids', true), '')::text[]));

-- `review_verdicts` NÃO tem `tenant_id`: corta por JOIN até a versão, que é
-- raiz. É a mesma escolha de `briefing_versions`/`briefing_drafts` — e o motivo
-- de ela ser segura aqui é que nenhuma rota busca parecer por `id` solto.
ALTER TABLE "review_verdicts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "review_verdicts" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "review_verdicts"
  USING (EXISTS (
    SELECT 1 FROM "artifact_versions" av
    WHERE av."id" = "review_verdicts"."artifact_version_id"
      AND av."tenant_id" = ANY (NULLIF(current_setting('app.tenant_ids', true), '')::text[])
  ));
