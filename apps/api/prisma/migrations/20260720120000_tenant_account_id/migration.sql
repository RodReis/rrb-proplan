-- Reinstall re-liga o Tenant (SPEC-022, §Notas técnicas) — eixo-2 do PR-5.
--
-- O casamento tenant↔instalação passa a ser pelo id numérico da conta. Ele é o
-- único identificador estável que o GitHub expõe aqui: `installation_id` muda a
-- cada reinstall e `account_login` muda num rename de conta. Sem esta coluna,
-- um rename faria o ProPlan criar um tenant duplicado e orfanar projetos e
-- settings do antigo — exatamente o dano que a PK própria do Tenant existe
-- para impedir.
--
-- NULLABLE de propósito: as linhas existentes nascem sem `account_id`. Uma
-- migration não deve chamar a rede — buscar o id no GitHub aqui tornaria o
-- deploy dependente de token válido e da disponibilidade da API. O primeiro
-- `listInstallations` preenche, casando por login (fallback só para estas
-- linhas, no máximo uma vez cada).
ALTER TABLE "tenants" ADD COLUMN "account_id" INTEGER;

-- Uma conta = um tenant (1:1 no 1º corte, como `installation_id`). O índice
-- único ignora NULLs no Postgres, então as linhas pré-migration convivem.
CREATE UNIQUE INDEX "tenants_account_id_key" ON "tenants"("account_id");
