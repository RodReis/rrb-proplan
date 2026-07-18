-- Fatia 8 — Emenda E1 (SPEC-022 / ADR-020): contexto RLS por ARRAY de membership.
--
-- Muda o contexto de `app.tenant_id` (singular, `=`) para `app.tenant_ids`
-- (array, `= ANY`). Uma policy só passa a servir os dois casos:
--   - rota escopada (/t/:tenant): array de 1 id;
--   - rota global (catálogo, SPEC-021): array com TODOS os tenants de membership
--     do usuário — lê cross-tenant SEM desligar RLS.
-- Sem contexto: current_setting(..., true) = NULL → `= ANY(NULL)` → zero linhas
-- (fail-closed preservado). O array é derivado da identidade autenticada, nunca
-- de input do cliente (garantido na app, ADR-020 regra 1).
--
-- Recria as policies (DROP + CREATE); ENABLE/FORCE já vêm da migração anterior.

-- Raízes.
DROP POLICY IF EXISTS "tenant_isolation" ON "projects";
CREATE POLICY "tenant_isolation" ON "projects"
  USING ("tenant_id" = ANY (NULLIF(current_setting('app.tenant_ids', true), '')::text[]));

DROP POLICY IF EXISTS "tenant_isolation" ON "settings";
CREATE POLICY "tenant_isolation" ON "settings"
  USING ("tenant_id" = ANY (NULLIF(current_setting('app.tenant_ids', true), '')::text[]));

-- llm_usage: nullable (histórico órfão) pertence ao contexto ativo.
DROP POLICY IF EXISTS "tenant_isolation" ON "llm_usage";
CREATE POLICY "tenant_isolation" ON "llm_usage"
  USING (
    "tenant_id" = ANY (NULLIF(current_setting('app.tenant_ids', true), '')::text[])
    OR "tenant_id" IS NULL
  );

-- Filhas: herdam por join à projects (a RLS de projects já corta a subquery).
DO $$
DECLARE
  t text;
  child_tables text[] := ARRAY[
    'documents', 'doc_links', 'document_resolutions', 'canonical_fields',
    'assertions', 'insights', 'insight_runs', 'sync_runs', 'board_mutations',
    'operations', 'suppressed_links', 'issues'
  ];
BEGIN
  FOREACH t IN ARRAY child_tables LOOP
    EXECUTE format('DROP POLICY IF EXISTS "tenant_isolation" ON %I', t);
    EXECUTE format(
      'CREATE POLICY "tenant_isolation" ON %I USING ('
      || 'project_id IN (SELECT id FROM projects WHERE tenant_id = ANY '
      || '(NULLIF(current_setting(''app.tenant_ids'', true), '''')::text[])))',
      t
    );
  END LOOP;
END $$;
