-- CreateEnum
CREATE TYPE "LlmUsageStatus" AS ENUM ('ok', 'error', 'discarded');

-- CreateEnum
CREATE TYPE "CostSource" AS ENUM ('provider', 'table', 'none');

-- AlterTable
ALTER TABLE "settings" ADD COLUMN     "llm_alert_usd_monthly" DECIMAL(10,4) NOT NULL DEFAULT 5,
ADD COLUMN     "llm_hard_cap_usd_monthly" DECIMAL(10,4) NOT NULL DEFAULT 20;

-- CreateTable
CREATE TABLE "llm_usage" (
    "id" TEXT NOT NULL,
    "project_id" TEXT,
    "kind" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "attempt" INTEGER NOT NULL DEFAULT 1,
    "status" "LlmUsageStatus" NOT NULL,
    "input_tokens" INTEGER NOT NULL,
    "output_tokens" INTEGER NOT NULL,
    "cache_creation_tokens" INTEGER NOT NULL DEFAULT 0,
    "cache_read_tokens" INTEGER NOT NULL DEFAULT 0,
    "cost_usd" DECIMAL(12,8),
    "cost_source" "CostSource" NOT NULL,
    "price_missing" BOOLEAN NOT NULL DEFAULT false,
    "price_snapshot" JSONB,
    "priced_at" TIMESTAMP(3),
    "error_code" TEXT,
    "latency_ms" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "llm_usage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "model_prices" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "input_per_1m" DECIMAL(12,6) NOT NULL,
    "output_per_1m" DECIMAL(12,6) NOT NULL,
    "cache_write_per_1m" DECIMAL(12,6) NOT NULL DEFAULT 0,
    "cache_read_per_1m" DECIMAL(12,6) NOT NULL DEFAULT 0,
    "effective_from" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "source" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "model_prices_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "llm_usage_created_at_idx" ON "llm_usage"("created_at");

-- CreateIndex
CREATE INDEX "llm_usage_project_id_created_at_idx" ON "llm_usage"("project_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "model_prices_provider_model_effective_from_key" ON "model_prices"("provider", "model", "effective_from");

-- AddForeignKey
ALTER TABLE "llm_usage" ADD CONSTRAINT "llm_usage_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;
