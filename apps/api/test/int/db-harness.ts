/**
 * Harness dos testes do project jest `banco` (int-spec) contra Postgres REAL.
 *
 * Por que real e não mock: os critérios de RLS da SPEC-022 (isolamento por
 * tenant, vazamento cortado na camada de banco) NÃO se provam com Prisma
 * mockado — a policy só existe no Postgres. Todo o resto da suíte (`regras`)
 * mocka o client; estes int-spec são a exceção deliberada.
 *
 * Duas conexões, espelhando produção (Fatia 8):
 *   - ownerClient: role `proplan` (owner) — aplica migrations/DDL, faz setup.
 *   - appClient:   role `proplan_app` (NÃO-owner) — é o que a API usa em
 *     runtime e o único sujeito a RLS. Testar isolamento pelo ownerClient
 *     mentiria (owner pula RLS), então as asserções de isolamento usam appClient.
 *
 * Requer Postgres de pé (docker compose up) com a role proplan_app criada
 * (docker/postgres-init/01-app-role.sql). O banco de teste é separado do dev
 * para não sujar dados locais.
 */
import { PrismaClient } from '@prisma/client';
import { execSync } from 'node:child_process';

const OWNER_URL =
  process.env.TEST_DIRECT_URL ??
  'postgresql://proplan:proplan@localhost:5433/proplan_test';
const APP_URL =
  process.env.TEST_DATABASE_URL ??
  'postgresql://proplan_app:proplan_app@localhost:5433/proplan_test';

export function ownerClient(): PrismaClient {
  return new PrismaClient({ datasources: { db: { url: OWNER_URL } } });
}

export function appClient(connectionLimit?: number): PrismaClient {
  // connectionLimit=1 força reuso da mesma conexão do pool — usado pelo teste de
  // vazamento transaction-scoped, onde um SET de sessão (bug) vazaria entre
  // chamadas na conexão compartilhada.
  const url = connectionLimit
    ? `${APP_URL}${APP_URL.includes('?') ? '&' : '?'}connection_limit=${connectionLimit}`
    : APP_URL;
  return new PrismaClient({ datasources: { db: { url } } });
}

/**
 * Aplica o schema no banco de teste via `prisma migrate deploy` (como owner).
 * Idempotente: rodar de novo num banco já migrado é no-op. Chamar uma vez no
 * `beforeAll` da suíte de int-spec.
 */
export function applyMigrations(): void {
  execSync('npx prisma migrate deploy', {
    env: { ...process.env, DIRECT_URL: OWNER_URL, DATABASE_URL: APP_URL },
    stdio: 'inherit',
    cwd: process.cwd(),
  });
}

/**
 * Concede à role de app (proplan_app) acesso às tabelas recém-migradas.
 * Necessário PÓS-migração: o init `01-app-role.sql` roda no initdb com o banco
 * vazio, então seu `GRANT ON ALL TABLES` é no-op para as tabelas que só nascem
 * depois, via `prisma migrate`. Rodar após applyMigrations() no beforeAll.
 * Usa o ownerClient (só o owner pode conceder). Idempotente.
 */
export async function grantAppRole(owner: PrismaClient): Promise<void> {
  await owner.$executeRawUnsafe(
    'GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO proplan_app',
  );
  await owner.$executeRawUnsafe(
    'GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO proplan_app',
  );
}
