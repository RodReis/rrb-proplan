-- SPEC-036 — `resolve_license` passa a devolver `issued_at`.
--
-- Emenda ao PR-1, encontrada ao escrever o PR-3. A função nasceu com as colunas
-- que decidem SE a ativação é permitida (status, limites, janelas) e faltou a
-- que o license file precisa CARREGAR: `issuedAt` é um dos 10 campos do
-- contrato público (MVP4 §5), e o `/activate` roda sem sessão — não há segunda
-- consulta possível antes de estabelecer o contexto do tenant.
--
-- Sem esta coluna, o único jeito de montar o payload seria repetir outro campo
-- no lugar (o que produziria um arquivo assinado dizendo uma data que não é a
-- da emissão) ou abrir uma leitura fora de contexto (que o RLS fail-closed
-- devolveria vazia).
--
-- Continua **sem nada do comprador**: a razão de a saída ser estreita é que a
-- função roda com privilégio de owner numa rota sem sessão, e isso não mudou.
-- `issued_at` é atributo da licença, não da pessoa.

-- `DROP` é obrigatório: o Postgres recusa `CREATE OR REPLACE` que muda o tipo
-- de retorno (`42P13`), e acrescentar uma coluna à `RETURNS TABLE` muda. O
-- preço do DROP é perder os privilégios da função — daí o `GRANT` no fim deste
-- arquivo não ser cerimônia: sem ele a role da aplicação fica sem `EXECUTE` e
-- **toda ativação passa a falhar** com erro de permissão.
DROP FUNCTION IF EXISTS resolve_license(text);

CREATE FUNCTION resolve_license(p_key_hash text)
RETURNS TABLE (
  id text,
  tenant_id text,
  status text,
  issued_at timestamp(3),
  expires_at timestamp(3),
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
         l.updates_until, e.max_machines, e.slug, e.billing_model::text
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
