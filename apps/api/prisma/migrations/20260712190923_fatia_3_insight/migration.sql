-- CreateEnum
CREATE TYPE "LlmProvider" AS ENUM ('anthropic', 'openai', 'openrouter');

-- CreateEnum
CREATE TYPE "InsightKind" AS ENUM ('summary', 'status_bootstrap');

-- AlterTable
ALTER TABLE "projects" ADD COLUMN     "commit_meta_synced_at" TIMESTAMP(3),
ADD COLUMN     "last_code_commit_at" TIMESTAMP(3),
ADD COLUMN     "last_docs_commit_at" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "settings" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "llm_provider" "LlmProvider" NOT NULL DEFAULT 'anthropic',
    "docs_staleness_threshold_days" INTEGER NOT NULL DEFAULT 90,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "insights" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "kind" "InsightKind" NOT NULL,
    "docs_tree_sha" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "input_tokens" INTEGER NOT NULL,
    "output_tokens" INTEGER NOT NULL,
    "content" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "insights_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "settings_user_id_key" ON "settings"("user_id");

-- CreateIndex
CREATE INDEX "insights_project_id_kind_created_at_idx" ON "insights"("project_id", "kind", "created_at");

-- AddForeignKey
ALTER TABLE "insights" ADD CONSTRAINT "insights_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
