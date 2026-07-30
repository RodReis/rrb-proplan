-- SPEC-038 (PR-4) — `resolve_license` passa a devolver `past_due_at`.
--
-- O PR-1 criou a coluna e a `resolve_past_due_tolerance`; o PR-3 passou a
-- gravá-la no evento de atraso. Faltava o dado chegar à **validação**, que é o
-- único lugar onde o corte pode acontecer: a spec é explícita — *"a comparação
-- mora na validação, como a de `expiresAt` — nunca em job"*.
--
-- Sem esta coluna o gate não tem o que comparar, e a inadimplência marcada pelo
-- webhook não cortaria nada. Seria a versão silenciosa do defeito que a
-- `resolve_past_due_tolerance` foi criada para evitar: a tolerância legível, o
-- atraso registrado, e o acesso seguindo liberado para sempre.
--
-- Segunda consulta não é alternativa: `/activate` e `/heartbeat` rodam **sem
-- sessão**, e ler `licenses` fora de contexto devolve vazio (RLS fail-closed).
--
-- Continua **sem nada do comprador** — a saída é estreita porque a função roda
-- com privilégio de owner numa rota pública, e isso não mudou. `past_due_at` é
-- atributo da licença, não da pessoa.

-- `DROP` é obrigatório: o Postgres recusa `CREATE OR REPLACE` que muda o tipo
-- de retorno (`42P13`), e acrescentar coluna à `RETURNS TABLE` muda. O DROP leva
-- os privilégios junto — o `GRANT` no fim não é cerimônia: sem ele a role da
-- aplicação fica sem `EXECUTE` e **toda ativação falha** por permissão.
DROP FUNCTION IF EXISTS resolve_license(text);

CREATE FUNCTION resolve_license(p_key_hash text)
RETURNS TABLE (
  id text,
  tenant_id text,
  status text,
  issued_at timestamp(3),
  expires_at timestamp(3),
  past_due_at timestamp(3),
  updates_until timestamp(3),
  max_machines integer,
  edition_slug text,
  billing_model text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT l.id, l.tenant_id, l.status::text, l.issued_at, l.expires_at,
         l.past_due_at, l.updates_until, e.max_machines, e.slug,
         e.billing_model::text
  FROM licenses l
  JOIN lic_editions e ON e.id = l.edition_id
  WHERE l.key_hash = p_key_hash
  LIMIT 1;
$$;

-- O DROP acima levou os privilégios junto. Reconceder é o que mantém a função
-- utilizável pela aplicação — e o `int-spec` roda com a role `proplan_app`
-- justamente para que esquecer isto quebre o teste, não a produção.
REVOKE ALL ON FUNCTION resolve_license(text) FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'proplan_app') THEN
    GRANT EXECUTE ON FUNCTION resolve_license(text) TO proplan_app;
  END IF;
END $$;
