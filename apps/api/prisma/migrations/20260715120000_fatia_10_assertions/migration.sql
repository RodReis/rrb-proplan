-- Fatia 10 (SPEC-015, ADR-013): asserção humana — índice reconstruível de
-- docs/CONTEXT.md. A fonte viva é o repo; apagar + re-sync reconstrói.

-- AlterEnum: o fluxo de captura/revalidação é uma Operation (SPEC-010).
ALTER TYPE "OperationKind" ADD VALUE 'assertion';

-- CreateTable
CREATE TABLE "assertions" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "statement" TEXT NOT NULL,
    "paths" TEXT[],
    "author" TEXT NOT NULL,
    "asserted_at" TEXT NOT NULL,
    "asserted_sha" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "body" TEXT NOT NULL DEFAULT '',
    "context_path" TEXT NOT NULL DEFAULT 'docs/CONTEXT.md',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "assertions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "assertions_project_id_idx" ON "assertions"("project_id");

-- AddForeignKey
ALTER TABLE "assertions" ADD CONSTRAINT "assertions_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
