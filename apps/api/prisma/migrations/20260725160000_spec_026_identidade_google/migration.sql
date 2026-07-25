-- SPEC-026 (#94): identidade ⊥ conexão. A conta no ProPlan passa a ser
-- autenticada por um IdP (Google); o GitHub deixa de ser a identidade.
--
-- `github_id` vira nullable: uma conta nasce só com Google e pode nunca
-- conectar o GitHub. Nenhum backfill é necessário — as linhas existentes já têm
-- github_id preenchido e continuam válidas; elas ganham google_id no primeiro
-- login pós-deploy, casadas por email (AuthService.handleGoogleCallback).
ALTER TABLE "users" ALTER COLUMN "github_id" DROP NOT NULL;

ALTER TABLE "users" ADD COLUMN "google_id" TEXT;
ALTER TABLE "users" ADD COLUMN "email" TEXT;

-- @unique em ambas: google_id é o `sub` do OpenID (uma conta Google = um
-- usuário) e email é a chave de casamento da migração — dois usuários com o
-- mesmo email tornariam ambíguo qual conta migrar.
CREATE UNIQUE INDEX "users_google_id_key" ON "users"("google_id");
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");
