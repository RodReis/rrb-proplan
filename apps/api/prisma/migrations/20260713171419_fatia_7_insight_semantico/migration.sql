-- AlterEnum
ALTER TYPE "DocLinkKind" ADD VALUE 'inferred';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "InsightKind" ADD VALUE 'architecture_fallback';
ALTER TYPE "InsightKind" ADD VALUE 'design_fallback';
ALTER TYPE "InsightKind" ADD VALUE 'edges_marker';
ALTER TYPE "InsightKind" ADD VALUE 'classify_marker';

-- AlterTable
ALTER TABLE "doc_links" ADD COLUMN     "reason" TEXT;

-- CreateTable
CREATE TABLE "suppressed_links" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "source_path" TEXT NOT NULL,
    "target_path" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "suppressed_links_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "suppressed_links_project_id_source_path_target_path_key" ON "suppressed_links"("project_id", "source_path", "target_path");

-- AddForeignKey
ALTER TABLE "suppressed_links" ADD CONSTRAINT "suppressed_links_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
