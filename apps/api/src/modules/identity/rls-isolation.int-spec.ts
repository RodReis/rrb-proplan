/**
 * Isolamento por RLS (SPEC-022, F1) — a fronteira de segurança do multi-tenant.
 * Roda contra Postgres REAL conectando como `proplan_app` (não-owner). Testar
 * pelo owner mentiria: o Postgres pula RLS para o owner da tabela.
 *
 * Prova os critérios de aceite da spec (linhas 55-58):
 *   - sem contexto de tenant → 0 linhas (fail-closed);
 *   - com contexto A → só linhas de A; com B → só de B;
 *   - tabela-filha herda o escopo por join à projects (sem coluna tenant_id).
 *
 * Requer `docker compose up` (Postgres + role proplan_app) e o banco de teste
 * migrado. Pré-requisito: PR-1 (role) + esta migração (PR-2).
 */
import { PrismaClient } from '@prisma/client';
import { ownerClient, appClient, applyMigrations, grantAppRole } from '../../../test/int/db-harness';

const TENANT_A = '00000000-0000-4000-8000-aaaaaaaaaaaa';
const TENANT_B = '00000000-0000-4000-8000-bbbbbbbbbbbb';

async function setTenant(client: PrismaClient, tenantIds: string[], sql: string): Promise<unknown> {
  // SET LOCAL de app.tenant_ids (array) = o mesmo mecanismo do runtime (E1).
  const arrayLiteral = `{${tenantIds.join(',')}}`;
  return client.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SELECT set_config('app.tenant_ids', $1, true)`, arrayLiteral);
    return tx.$queryRawUnsafe(sql);
  });
}

describe('RLS: isolamento por tenant (proplan_app)', () => {
  let owner: PrismaClient;
  let app: PrismaClient;

  beforeAll(async () => {
    applyMigrations();
    owner = ownerClient();
    app = appClient();
    await grantAppRole(owner);

    // Seed como owner (não sujeito a RLS): 2 tenants, 1 projeto + 1 doc cada.
    // $executeRawUnsafe não aceita múltiplos comandos por chamada — um por vez.
    await owner.$executeRawUnsafe(
      `INSERT INTO users (id, github_id, login, created_at, updated_at) VALUES
        ('u-a', 901, 'alice', now(), now()), ('u-b', 902, 'bob', now(), now())
       ON CONFLICT (id) DO NOTHING`,
    );
    await owner.$executeRawUnsafe(
      `INSERT INTO tenants (id, account_login, account_type, created_at) VALUES
        ('${TENANT_A}', 'alice', 'User', now()), ('${TENANT_B}', 'bob', 'User', now())
       ON CONFLICT (id) DO NOTHING`,
    );
    await owner.$executeRawUnsafe(
      `INSERT INTO projects (id, user_id, tenant_id, github_repo_id, owner, name, default_branch, is_private, created_at) VALUES
        ('rls-p-a', 'u-a', '${TENANT_A}', 9010, 'alice', 'repo-a', 'main', false, now()),
        ('rls-p-b', 'u-b', '${TENANT_B}', 9020, 'bob', 'repo-b', 'main', false, now())
       ON CONFLICT (id) DO NOTHING`,
    );
    await owner.$executeRawUnsafe(
      `INSERT INTO documents (id, project_id, path, blob_sha, content, byte_size, updated_at) VALUES
        ('rls-d-a', 'rls-p-a', 'README.md', 'sha-a', 'x', 1, now()),
        ('rls-d-b', 'rls-p-b', 'README.md', 'sha-b', 'x', 1, now())
       ON CONFLICT (id) DO NOTHING`,
    );
  });

  afterAll(async () => {
    await owner.$executeRawUnsafe(`DELETE FROM documents WHERE id IN ('rls-d-a','rls-d-b')`);
    await owner.$executeRawUnsafe(`DELETE FROM projects WHERE id IN ('rls-p-a','rls-p-b')`);
    await owner.$executeRawUnsafe(`DELETE FROM tenants WHERE id IN ('${TENANT_A}','${TENANT_B}')`);
    await owner.$executeRawUnsafe(`DELETE FROM users WHERE id IN ('u-a','u-b')`);
    await owner.$disconnect();
    await app.$disconnect();
  });

  it('sem contexto de tenant, proplan_app vê 0 projetos (fail-closed)', async () => {
    const rows = (await app.$queryRawUnsafe(
      `SELECT id FROM projects WHERE id IN ('rls-p-a','rls-p-b')`,
    )) as unknown[];
    expect(rows).toHaveLength(0);
  });

  it('com contexto A, vê só o projeto de A', async () => {
    const rows = (await setTenant(
      app,
      [TENANT_A],
      `SELECT id FROM projects WHERE id IN ('rls-p-a','rls-p-b')`,
    )) as Array<{ id: string }>;
    expect(rows.map((r) => r.id)).toEqual(['rls-p-a']);
  });

  it('com contexto B, vê só o projeto de B', async () => {
    const rows = (await setTenant(
      app,
      [TENANT_B],
      `SELECT id FROM projects WHERE id IN ('rls-p-a','rls-p-b')`,
    )) as Array<{ id: string }>;
    expect(rows.map((r) => r.id)).toEqual(['rls-p-b']);
  });

  it('tabela-filha (documents) herda o escopo: contexto B não vê doc de A', async () => {
    const rows = (await setTenant(
      app,
      [TENANT_B],
      `SELECT id FROM documents WHERE id = 'rls-d-a'`,
    )) as unknown[];
    expect(rows).toHaveLength(0);
  });

  it('tabela-filha: contexto A vê o próprio doc', async () => {
    const rows = (await setTenant(
      app,
      [TENANT_A],
      `SELECT id FROM documents WHERE id = 'rls-d-a'`,
    )) as Array<{ id: string }>;
    expect(rows.map((r) => r.id)).toEqual(['rls-d-a']);
  });

  // Caso do catálogo (E1, ADR-020): array com AMBOS os tenants → vê os dois.
  // É a razão da emenda: a rota global lê cross-tenant sob RLS, sem bypass.
  it('contexto com array [A, B] (catálogo) vê projetos dos dois', async () => {
    const rows = (await setTenant(
      app,
      [TENANT_A, TENANT_B],
      `SELECT id FROM projects WHERE id IN ('rls-p-a','rls-p-b') ORDER BY id`,
    )) as Array<{ id: string }>;
    expect(rows.map((r) => r.id)).toEqual(['rls-p-a', 'rls-p-b']);
  });
});
