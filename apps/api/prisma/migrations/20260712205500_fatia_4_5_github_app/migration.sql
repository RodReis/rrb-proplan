-- Fatia 4.5 — Migração OAuth App → GitHub App (SPEC-008 / ADR-015).
-- Dois tokens: user-to-server (leitura) + refresh; installation token é
-- server-to-server (não persistido — cacheado em Redis).
-- Colunas de token nullable: só o PI existe e reloga após a migração (o token
-- do OAuth App não serve para o GitHub App). Projetos são preservados.

-- CreateEnum
CREATE TYPE "InstallationStatus" AS ENUM ('active', 'missing');

-- AlterTable
ALTER TABLE "projects" ADD COLUMN     "installation_id" INTEGER,
ADD COLUMN     "installation_status" "InstallationStatus" NOT NULL DEFAULT 'active';

-- AlterTable
ALTER TABLE "users" DROP COLUMN "encrypted_github_token",
ADD COLUMN     "encrypted_refresh_token" TEXT,
ADD COLUMN     "encrypted_user_token" TEXT,
ADD COLUMN     "token_expires_at" TIMESTAMP(3);
