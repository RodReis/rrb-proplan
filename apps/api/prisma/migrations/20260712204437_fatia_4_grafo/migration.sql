-- CreateEnum
CREATE TYPE "DocLinkKind" AS ENUM ('explicit');

-- CreateTable
CREATE TABLE "doc_links" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "source_document_id" TEXT NOT NULL,
    "target_document_id" TEXT,
    "target_path" TEXT NOT NULL,
    "kind" "DocLinkKind" NOT NULL DEFAULT 'explicit',
    "anchor" TEXT,

    CONSTRAINT "doc_links_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "doc_links_project_id_idx" ON "doc_links"("project_id");

-- CreateIndex
CREATE INDEX "doc_links_source_document_id_idx" ON "doc_links"("source_document_id");

-- AddForeignKey
ALTER TABLE "doc_links" ADD CONSTRAINT "doc_links_source_document_id_fkey" FOREIGN KEY ("source_document_id") REFERENCES "documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "doc_links" ADD CONSTRAINT "doc_links_target_document_id_fkey" FOREIGN KEY ("target_document_id") REFERENCES "documents"("id") ON DELETE SET NULL ON UPDATE CASCADE;
