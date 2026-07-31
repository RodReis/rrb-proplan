-- SPEC-041 (PR-2) — `resolve_license` passa a devolver `product_id`.
--
-- O `releases/check` precisa responder *"qual a versão mais nova autorizada para
-- ESTA licença?"*, e releases penduram no **produto** (`lic_releases.product_id`).
-- A licença conhece a edição; a edição conhece o produto. Sem esta coluna a rota
-- não tem por onde começar a busca.
--
-- **Segunda consulta não é alternativa** — mesma razão da SPEC-038 (PR-4):
-- `releases/check` roda **sem sessão**, e ler `lic_editions` fora de contexto
-- devolve vazio (RLS fail-closed). O sintoma seria a rota respondendo
-- *"nenhuma atualização"* para toda licença válida: a máquina do cliente nunca
-- mais recebe update, e nada aparece em log — o modo de errar mudo que a
-- SPEC-041 §Critérios de aceite persegue.
--
-- **A saída continua estreita, e a regra não mudou**: `product_id` é atributo da
-- LICENÇA (por qual produto ela foi emitida), não do comprador. Nada de e-mail,
-- nome ou `saleRef` entra aqui — a função roda com privilégio de owner numa rota
-- pública, e é a estreiteza da projeção que mantém isso defensável.

-- `DROP` é obrigatório: o Postgres recusa `CREATE OR REPLACE` que muda o tipo de
-- retorno (`42P13`), e acrescentar coluna à `RETURNS TABLE` muda. O DROP leva os
-- privilégios junto — o `GRANT` no fim não é cerimônia: sem ele a role da
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
  billing_model text,
  product_id text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT l.id, l.tenant_id, l.status::text, l.issued_at, l.expires_at,
         l.past_due_at, l.updates_until, e.max_machines, e.slug,
         e.billing_model::text, e.product_id
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
