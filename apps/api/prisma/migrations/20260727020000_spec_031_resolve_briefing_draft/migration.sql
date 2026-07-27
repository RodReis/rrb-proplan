-- SPEC-031 (Fatia 20) — resolução pública do link COM o rascunho.
--
-- Mesmo problema e mesma solução da `resolve_briefing_link` (SPEC-029): a rota
-- `/b/:token` não tem sessão, roda sem `app.tenant_ids`, e o RLS é fail-closed.
-- Um SELECT direto aqui volta vazio e o formulário nunca carregaria o rascunho.
--
-- Por que uma função NOVA em vez de estender a existente: mudar o tipo de
-- retorno de `resolve_briefing_link` exigiria DROP+CREATE, e a função antiga
-- continua servindo o caso "só quero saber se o link vale" sem carregar o
-- jsonb de respostas. Duas funções, dois custos diferentes, ambas de
-- superfície mínima.
--
-- Continua valendo tudo da anterior: recebe só o hash, devolve uma linha, não
-- lista, não pagina, não aceita filtro livre. `search_path` fixo é obrigatório
-- em SECURITY DEFINER — sem ele o caller poderia apontar `clients` para uma
-- tabela própria e a função rodaria com privilégio de owner sobre ela.

CREATE OR REPLACE FUNCTION resolve_briefing_draft(p_token_hash text)
RETURNS TABLE (
  link_id text,
  expires_at timestamp(3),
  revoked_at timestamp(3),
  tenant_id text,
  client_project_id text,
  project_state text,
  draft_id text,
  draft_step integer,
  draft_answers jsonb,
  draft_consumed_at timestamp(3),
  -- Contagem de versões enviadas: > 0 significa "briefing recebido", e a
  -- tela responde isso em vez de reabrir o formulário (spec §5).
  version_count integer
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    bl.id,
    bl.expires_at,
    bl.revoked_at,
    c.tenant_id,
    bl.client_project_id,
    cp.state::text,
    bd.id,
    bd.step,
    bd.answers,
    bd.consumed_at,
    (SELECT count(*)::int FROM briefing_versions bv WHERE bv.briefing_link_id = bl.id)
  FROM briefing_links bl
  JOIN client_projects cp ON cp.id = bl.client_project_id
  JOIN clients c ON c.id = cp.client_id
  -- LEFT: link sem rascunho é o caso normal do primeiro acesso, não ausência
  -- de link. Um INNER aqui faria todo link novo responder `invalid`.
  LEFT JOIN briefing_drafts bd ON bd.briefing_link_id = bl.id
  WHERE bl.token_hash = p_token_hash
    AND cp.deleted_at IS NULL
    AND c.deleted_at IS NULL
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION resolve_briefing_draft(text) FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'proplan_app') THEN
    GRANT EXECUTE ON FUNCTION resolve_briefing_draft(text) TO proplan_app;
  END IF;
END $$;
