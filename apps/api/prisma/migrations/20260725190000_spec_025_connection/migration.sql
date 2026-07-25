-- SPEC-025 — a conexão GitHub sai do `User` e vira entidade própria.
--
-- A ordem importa: cria a tabela, **copia os tokens de quem já existe** e só
-- então derruba as colunas. Sem o INSERT do meio, todo usuário em produção
-- perderia o token no deploy e precisaria reconectar — o PI tem 8 projetos.

CREATE TABLE "connections" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "encrypted_user_token" TEXT,
    "encrypted_refresh_token" TEXT,
    "token_expires_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "connections_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "connections_user_id_provider_key" ON "connections"("user_id", "provider");

ALTER TABLE "connections" ADD CONSTRAINT "connections_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill: cada usuário com token vira uma conexão `github`. Quem nunca
-- conectou (conta nascida do Google) não gera linha — ausência é o estado
-- "sem conexão", que é exatamente o que o catálogo vai ler.
INSERT INTO "connections" (
    "id", "user_id", "provider",
    "encrypted_user_token", "encrypted_refresh_token", "token_expires_at",
    "created_at", "updated_at"
)
SELECT
    gen_random_uuid()::text, "id", 'github',
    "encrypted_user_token", "encrypted_refresh_token", "token_expires_at",
    CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "users"
WHERE "encrypted_user_token" IS NOT NULL;

ALTER TABLE "users" DROP COLUMN "encrypted_user_token";
ALTER TABLE "users" DROP COLUMN "encrypted_refresh_token";
ALTER TABLE "users" DROP COLUMN "token_expires_at";
