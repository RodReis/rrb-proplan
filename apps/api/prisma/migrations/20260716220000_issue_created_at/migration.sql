-- Issue.createdAt: nascimento da issue no GitHub (fato nativo, não carimbo nosso).
-- O card mostra "aberta em" fora de Finalizado/Descartado; lá quem vale é closed_at.

-- Backfill das linhas existentes com `updated_at` (NOT NULL exige um valor).
-- Por que não `now()`: cravaria "nasceu hoje" em issue antiga — um fato falso,
-- exatamente o que este produto existe para detectar. `updated_at` é o fato mais
-- próximo que o cache já tem: erra para frente (nunca antes do nascimento real) e
-- é transitório — o cache é reconstruível (ADR-011: o GitHub é a fonte), então o
-- próximo sync sobrescreve tudo com o `created_at` verdadeiro do GitHub.
ALTER TABLE "issues" ADD COLUMN "created_at" TIMESTAMP(3);
UPDATE "issues" SET "created_at" = "updated_at" WHERE "created_at" IS NULL;
ALTER TABLE "issues" ALTER COLUMN "created_at" SET NOT NULL;
