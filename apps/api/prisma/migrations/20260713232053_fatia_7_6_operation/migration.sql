-- CreateEnum
CREATE TYPE "OperationKind" AS ENUM ('promote', 'mapping', 'bootstrap', 'board_mutation');

-- CreateEnum
CREATE TYPE "OperationStatus" AS ENUM ('running', 'done', 'failed');

-- CreateTable
CREATE TABLE "operations" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "kind" "OperationKind" NOT NULL,
    "status" "OperationStatus" NOT NULL DEFAULT 'running',
    "steps" JSONB NOT NULL,
    "commit_url" TEXT,
    "sync_run_id" TEXT,
    "error" TEXT,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMP(3),

    CONSTRAINT "operations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "operations_project_id_started_at_idx" ON "operations"("project_id", "started_at");

-- AddForeignKey
ALTER TABLE "operations" ADD CONSTRAINT "operations_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
