-- SPEC-048 (emenda de 2026-08-05) — a enumeração de tenants das rodadas diárias.
--
-- ## O defeito que estas funções consertam
--
-- As rodadas recorrentes precisam responder *"quais tenants?"* ANTES de abrir
-- contexto de tenant nenhum — é a pergunta que atravessa a fronteira por
-- definição. Mas `proplan_app` é `NOSUPERUSER` e `NOBYPASSRLS` (o
-- `bootstrap-app-role.mjs` falha explicitamente se `rolbypassrls` estiver
-- ligado), e a política das `lic_*` compara com `app.tenant_ids`:
--
--   USING (tenant_id = ANY (NULLIF(current_setting('app.tenant_ids', true), '')::text[]))
--
-- Sem contexto, `current_setting(..., true)` devolve NULL, `x = ANY(NULL)` é
-- NULL, e nenhuma linha passa. **Zero linhas, sem erro** — a rodada varre zero
-- tenants e reporta sucesso tendo feito nada. Verificado contra o Postgres real
-- em 2026-08-05: o owner enxerga 1 `lic_settings` e 2 `licenses`; `proplan_app`
-- sem contexto enxerga 0 e 0.
--
-- ## Primeira enumeração do repo a atravessar o RLS (ADR-030)
--
-- As seis `resolve_*` existentes recebem uma chave que o chamador **já tem** e
-- devolvem **uma** linha. Estas recebem nada e devolvem um **conjunto** — é
-- categoria nova, e por isso tem ADR próprio.
--
-- Três regras que a mantêm segura, e são o que o ADR-030 fixa:
--
-- 1. **Devolvem `tenant_id` e nada mais.** Nunca `github_pat`, nunca
--    `kiwify_client_secret`, nunca `webhook_secret`. Uma função com privilégio
--    de owner que devolvesse segredo daria a qualquer chamador o poder de forjar
--    entrega assinada — a mesma razão já fixada na `resolve_past_due_tolerance`.
-- 2. **O RLS das tabelas não muda.** `proplan_app` continua sem enxergar
--    `lic_settings` e `licenses` fora de contexto; a função é o único caminho.
-- 3. **O filtro é economia, não regra.** Quem decide continua no service: o
--    `reconcile` sai cedo sem PAT ou sem `sourceRepo`, e o `updateMany` do sweep
--    é inócuo num tenant sem licença vencida. Um filtro errado desperdiça uma
--    volta de laço; ele não pode ser a razão pela qual um convite sai ou não sai.

-- Tenants com PAT de source configurado — a lista do `source-reconcile`.
--
-- **Não filtra por Kiwify**, ao contrário do sync do catálogo: um tenant com PAT
-- e sem Kiwify seria pulado, e o convite nunca sairia — falha muda, exatamente a
-- que a SPEC-048 existe para acabar.
CREATE OR REPLACE FUNCTION lic_tenants_with_source_pat()
RETURNS TABLE (tenant_id text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT s.tenant_id FROM lic_settings s WHERE s.github_pat IS NOT NULL;
$$;

-- Tenants com licença que pode expirar — a lista do `expiry-sweep`.
--
-- **Sem filtro de credencial nenhum**: o sweep não fala com ninguém de fora, é
-- `updateMany` local. Exigir credencial deixaria licença vencida aparecendo como
-- `ACTIVE` no admin de todo tenant que não usa aquela credencial.
--
-- `expires_at IS NOT NULL` porque PERPETUAL nunca expira — o tenant que só tem
-- licença vitalícia não precisa de volta de laço.
CREATE OR REPLACE FUNCTION lic_tenants_with_expiring_licenses()
RETURNS TABLE (tenant_id text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT DISTINCT l.tenant_id
  FROM licenses l
  WHERE l.status = 'ACTIVE' AND l.expires_at IS NOT NULL;
$$;

-- Tenants com as três credenciais da Kiwify — a lista do `catalog-sync`.
--
-- **Esta conserta a Fatia 36, não a 37.** O `tenantsConfigurados()` da SPEC-047
-- nasceu com o mesmo `findMany` fora de contexto, e o sync diário em produção
-- enumera zero tenants desde que foi ligado. A SPEC-048 o declara `[FIX]` do
-- Code e **pré-requisito** desta fatia: consertar só as duas rodadas novas
-- deixaria de pé, ao lado delas, o exemplo que ensina o erro.
CREATE OR REPLACE FUNCTION lic_tenants_with_kiwify_credentials()
RETURNS TABLE (tenant_id text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT s.tenant_id
  FROM lic_settings s
  WHERE s.kiwify_client_id IS NOT NULL
    AND s.kiwify_client_secret IS NOT NULL
    AND s.kiwify_account_id IS NOT NULL;
$$;

-- A função é o único caminho: REVOKE de PUBLIC + GRANT explícito, como as seis
-- `resolve_*`. Sem o REVOKE, `SECURITY DEFINER` + `PUBLIC` daria a enumeração a
-- qualquer role que um dia se conecte a este banco.
REVOKE ALL ON FUNCTION lic_tenants_with_source_pat() FROM PUBLIC;
REVOKE ALL ON FUNCTION lic_tenants_with_expiring_licenses() FROM PUBLIC;
REVOKE ALL ON FUNCTION lic_tenants_with_kiwify_credentials() FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'proplan_app') THEN
    GRANT EXECUTE ON FUNCTION lic_tenants_with_source_pat() TO proplan_app;
    GRANT EXECUTE ON FUNCTION lic_tenants_with_expiring_licenses() TO proplan_app;
    GRANT EXECUTE ON FUNCTION lic_tenants_with_kiwify_credentials() TO proplan_app;
  END IF;
END $$;
