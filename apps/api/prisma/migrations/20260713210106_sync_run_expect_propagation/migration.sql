-- AlterTable
ALTER TABLE "sync_runs" ADD COLUMN     "expect_blob_sha" TEXT,
ADD COLUMN     "expect_path" TEXT;
