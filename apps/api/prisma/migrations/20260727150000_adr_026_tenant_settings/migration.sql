-- ADR-026 — o teto de gasto de IA passa a pertencer ao tenant, não ao usuário.
--
-- 1º dos dois pré-requisitos da SPEC-032 (Fatia 21). Não é ajuste de
-- configuração: é migração de dados, e ela PERDE DADO DE PROPÓSITO.
--
-- O que estava errado: `settings.user_id` é UNIQUE, então um tenant com dois
-- membros tinha DOIS tetos sobre A MESMA soma, sem regra de desempate — o
-- resultado do gate dependia de quem chamou. Enquanto o produto foi de usuário
-- único, a distinção não custou nada; a SPEC-032 a cobra, porque o pipeline
-- dela dispara de briefing público ANÔNIMO, onde não existe `user_id` nenhum
-- para resolver teto a partir de pessoa.

CREATE TABLE "tenant_settings" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "llm_alert_usd_monthly" DECIMAL(10,4) NOT NULL DEFAULT 5,
    "llm_hard_cap_usd_monthly" DECIMAL(10,4) NOT NULL DEFAULT 20,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tenant_settings_pkey" PRIMARY KEY ("id")
);

-- UNIQUE, não índice comum: é a correção que motiva o ADR. Dois tetos para o
-- mesmo tenant é exatamente o estado de que estamos saindo — o banco passa a
-- recusá-lo em vez de confiar que o código não o crie.
CREATE UNIQUE INDEX "tenant_settings_tenant_id_key" ON "tenant_settings"("tenant_id");

ALTER TABLE "tenant_settings" ADD CONSTRAINT "tenant_settings_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- Teto negativo não existe. O service já valida, mas regra que só vive numa
-- função é regra que a próxima query esquece (o mesmo argumento que o ADR-026
-- usou para recusar "desempatar dentro do capsOf").
ALTER TABLE "tenant_settings" ADD CONSTRAINT "tenant_settings_amounts_non_negative"
  CHECK ("llm_alert_usd_monthly" >= 0 AND "llm_hard_cap_usd_monthly" >= 0);

-- ===========================================================================
-- Backfill — decisão 3 do ADR-026: VENCE O TETO DO `owner`.
--
-- Havendo mais de um `owner`, vence o de `memberships.created_at` mais antiga.
-- Tenant sem `owner` (não deve existir — o ADR-020/role-derivation garante que
-- o último owner nunca é rebaixado) cai no DEFAULT do schema por não casar no
-- JOIN: o LEFT JOIN devolve NULL e o COALESCE aplica 5/20.
--
-- One-way e destrutiva por decisão: os tetos configurados por não-`owner`
-- desaparecem. Eles nunca representaram o bolso de ninguém — representavam uma
-- leitura pessoal de um limite compartilhado.
-- ===========================================================================
INSERT INTO "tenant_settings" ("id", "tenant_id", "llm_alert_usd_monthly", "llm_hard_cap_usd_monthly", "updated_at")
SELECT
    gen_random_uuid()::text,
    t."id",
    COALESCE(s."llm_alert_usd_monthly", 5),
    COALESCE(s."llm_hard_cap_usd_monthly", 20),
    CURRENT_TIMESTAMP
FROM "tenants" t
LEFT JOIN LATERAL (
    SELECT s2."llm_alert_usd_monthly", s2."llm_hard_cap_usd_monthly"
    FROM "settings" s2
    JOIN "memberships" m ON m."user_id" = s2."user_id" AND m."tenant_id" = t."id"
    WHERE m."role" = 'owner'
    -- Desempate explícito: o owner mais antigo do tenant. `s2.user_id` no fim
    -- só para tornar a escolha determinística se dois memberships empatarem no
    -- timestamp (import em lote grava todos no mesmo instante).
    ORDER BY m."created_at" ASC, s2."user_id" ASC
    LIMIT 1
) s ON TRUE;

-- As colunas saem de `settings` DEPOIS do backfill. Ordem importa: dropar antes
-- levaria junto o dado que estamos migrando.
ALTER TABLE "settings" DROP COLUMN "llm_alert_usd_monthly";
ALTER TABLE "settings" DROP COLUMN "llm_hard_cap_usd_monthly";

-- ===========================================================================
-- RLS — tabela raiz de tenancy, mesmo desenho das demais (ADR-020).
--
-- FORCE: sem ele o Postgres pula a policy para o OWNER da tabela.
-- Fail-closed: sem `app.tenant_ids`, `NULLIF(...,'')` vira NULL, `= ANY(NULL)`
-- é NULL, e nenhuma linha sai.
--
-- Consequência que o ADR-026 (decisão 5) manda encarar de frente: somar ou ler
-- sem contexto NÃO dá erro — dá ZERO, e zero passa no gate. Todo caminho que
-- resolve teto abre `runInTenantContext` explicitamente, inclusive job sem
-- sessão. Esta frente já acumulou 5 ocorrências desta classe, todas com a
-- suíte verde.
-- ===========================================================================
ALTER TABLE "tenant_settings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tenant_settings" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "tenant_settings"
  USING ("tenant_id" = ANY (NULLIF(current_setting('app.tenant_ids', true), '')::text[]));
