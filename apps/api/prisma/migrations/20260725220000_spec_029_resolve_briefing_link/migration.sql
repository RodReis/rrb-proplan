-- SPEC-029 (Fatia 19) — lookup do link público sem contexto de tenant.
--
-- O PROBLEMA (achado no dogfooding, 2026-07-25): `GET /b/:token` não tem
-- sessão, então roda **sem** `app.tenant_ids`. O RLS de `briefing_links` e
-- `clients` é fail-closed, então o lookup voltava vazio e **todo token válido
-- respondia `invalid`** — o link público nunca funcionaria.
--
-- Os testes não pegaram porque mockam o `$queryRaw`: provam a lógica, não o
-- acesso ao banco. Mesma classe de lacuna da issue #122 (teste correto sobre um
-- dado que não existe).
--
-- A SOLUÇÃO: uma função `SECURITY DEFINER` que resolve **apenas** hash→link,
-- rodando com o privilégio do owner (que ignora RLS). Superfície mínima e
-- auditável:
--
--   - recebe UM argumento: o hash (SHA-256 hex de um token de 256 bits);
--   - devolve 4 colunas do link + o tenant, e nada mais;
--   - não aceita filtro livre, não lista, não pagina — não há como enumerar;
--   - o RLS continua ATIVO em todas as tabelas para todo o resto.
--
-- Por que não uma policy `USING (true)`: ela abriria a tabela inteira para
-- qualquer query sem contexto. Por que não uma role com BYPASSRLS: o ADR-022
-- proíbe explicitamente (o bootstrap FALHA se a role tiver `rolbypassrls`).
--
-- `search_path` fixo é obrigatório em SECURITY DEFINER: sem ele, um caller
-- poderia apontar `clients` para uma tabela própria e a função executaria com
-- privilégio de owner sobre ela.

CREATE OR REPLACE FUNCTION resolve_briefing_link(p_token_hash text)
RETURNS TABLE (
  id text,
  expires_at timestamp(3),
  revoked_at timestamp(3),
  tenant_id text,
  client_project_id text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT bl.id, bl.expires_at, bl.revoked_at, c.tenant_id, bl.client_project_id
  FROM briefing_links bl
  JOIN client_projects cp ON cp.id = bl.client_project_id
  JOIN clients c ON c.id = cp.client_id
  WHERE bl.token_hash = p_token_hash
    AND cp.deleted_at IS NULL
    AND c.deleted_at IS NULL
  LIMIT 1;
$$;

-- A função é o único caminho: `proplan_app` continua sem enxergar as tabelas
-- fora de contexto (o RLS não muda). REVOKE de PUBLIC + GRANT explícito para
-- que só a role da aplicação possa chamá-la.
REVOKE ALL ON FUNCTION resolve_briefing_link(text) FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'proplan_app') THEN
    GRANT EXECUTE ON FUNCTION resolve_briefing_link(text) TO proplan_app;
  END IF;
END $$;
