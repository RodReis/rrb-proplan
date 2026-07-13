-- Fatia 5 — Kanban sobre GitHub Issues (SPEC-005 / ADR-011).
-- issues e board_mutations são cache/auditoria; a fonte de estado são as
-- GitHub Issues. Project.needs_issue_import sinaliza STATUS.md legado.

-- CreateEnum
CREATE TYPE "BoardColumn" AS ENUM ('backlog', 'todo', 'doing', 'done', 'discarded');

-- CreateEnum
CREATE TYPE "IssuePriority" AS ENUM ('alta', 'media', 'baixa');

-- CreateEnum
CREATE TYPE "BoardMutationType" AS ENUM ('move_column', 'create_card', 'edit_card', 'discard_card');

-- CreateEnum
CREATE TYPE "BoardMutationStatus" AS ENUM ('queued', 'applying', 'applied', 'failed');

-- AlterTable
ALTER TABLE "projects" ADD COLUMN     "needs_issue_import" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "issues" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "column" "BoardColumn" NOT NULL,
    "priority" "IssuePriority",
    "assignee_login" TEXT,
    "assignee_avatar_url" TEXT,
    "html_url" TEXT NOT NULL,
    "closed_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "issues_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "board_mutations" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "type" "BoardMutationType" NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "BoardMutationStatus" NOT NULL DEFAULT 'queued',
    "error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMP(3),

    CONSTRAINT "board_mutations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "issues_project_id_column_idx" ON "issues"("project_id", "column");

-- CreateIndex
CREATE UNIQUE INDEX "issues_project_id_number_key" ON "issues"("project_id", "number");

-- CreateIndex
CREATE INDEX "board_mutations_project_id_created_at_idx" ON "board_mutations"("project_id", "created_at");

-- AddForeignKey
ALTER TABLE "issues" ADD CONSTRAINT "issues_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "board_mutations" ADD CONSTRAINT "board_mutations_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

