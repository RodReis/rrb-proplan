-- Fatia 8 (SPEC-022) — role de aplicação NÃO-owner, pré-requisito do RLS.
--
-- Por que existe: a app conectava como `proplan` (POSTGRES_USER), que é
-- SUPERUSER e owner de todas as tabelas. O Postgres PULA row-level security
-- para superuser e para o owner da tabela — então RLS seria no-op silencioso
-- (aparenta proteger, não protege). O isolamento multi-tenant (F1 da spec) só
-- vale se a app conectar como uma role sem esses privilégios.
--
-- Divisão de papéis:
--   proplan      (owner/superuser) → migrations e seed (precisam de DDL).
--   proplan_app  (esta role)       → runtime da API (sujeita a RLS).
--
-- Roda uma vez, na primeira subida do volume pgdata (docker-entrypoint-initdb.d).
-- Volume já existente NÃO re-executa — ver README de dev.

CREATE ROLE proplan_app WITH LOGIN PASSWORD 'proplan_app' NOSUPERUSER NOCREATEDB NOCREATEROLE;

GRANT USAGE ON SCHEMA public TO proplan_app;

-- Grants sobre as tabelas que já existem quando este script roda (nenhuma, na
-- 1ª subida — as tabelas nascem via `prisma migrate`). O ALTER DEFAULT abaixo é
-- o que garante o grant para TODA tabela futura criada pelo owner `proplan`.
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO proplan_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO proplan_app;

-- Toda tabela/sequência que `proplan` criar depois (as migrations) já nasce
-- acessível para `proplan_app` — sem precisar re-grantar a cada migration.
ALTER DEFAULT PRIVILEGES FOR ROLE proplan IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO proplan_app;
ALTER DEFAULT PRIVILEGES FOR ROLE proplan IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO proplan_app;
