-- AlterTable
ALTER TABLE "projects" ADD COLUMN     "proplan_config_invalid" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "document_resolutions" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "level" INTEGER NOT NULL,
    "source" TEXT NOT NULL,
    "path" TEXT,
    "paths" TEXT[],
    "confidence" DOUBLE PRECISION NOT NULL,
    "docs_tree_sha" TEXT,
    "resolved_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "document_resolutions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "document_resolutions_project_id_entity_key" ON "document_resolutions"("project_id", "entity");

-- AddForeignKey
ALTER TABLE "document_resolutions" ADD CONSTRAINT "document_resolutions_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
