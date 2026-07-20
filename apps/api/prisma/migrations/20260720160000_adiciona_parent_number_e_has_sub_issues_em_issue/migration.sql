-- Hierarquia de sub-issues (SPEC-024): parent_number = épico-pai (null = raiz);
-- has_sub_issues = é épico estrutural (excluído das colunas). Derivados no sync
-- via GraphQL; leitura apenas.
-- AlterTable
ALTER TABLE "issues" ADD COLUMN     "has_sub_issues" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "parent_number" INTEGER;
