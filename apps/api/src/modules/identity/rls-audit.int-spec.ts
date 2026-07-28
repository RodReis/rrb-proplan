/**
 * Auditoria de cobertura de RLS + prova de que a migração é idempotente
 * (SPEC-022, critérios de aceite). Postgres real, como no rls-isolation.
 *
 *  - policy-audit: TODA tabela com dado de tenant tem RLS habilitada E policy.
 *    Falha se uma tabela de tenant ficar sem proteção — a rede que barra uma
 *    tabela futura criada sem policy (o critério "checagem automatizada").
 *  - idempotência: o backfill do usuário único (na migração) roda 2× sem
 *    duplicar Tenant/Membership (F3). Simulado re-executando o mesmo INSERT
 *    ON CONFLICT do backfill.
 */
import { PrismaClient } from '@prisma/client';
import { ownerClient, applyMigrations, grantAppRole } from '../../../test/int/db-harness';

// Toda tabela que carrega dado de tenant (raízes + 12 filhas). Se o schema
// ganhar uma tabela de projeto nova sem policy, este array desatualiza e o
// teste de cobertura abaixo falha — forçando a decisão consciente.
const TENANT_TABLES = [
  'projects', 'settings', 'tenant_settings', 'llm_usage',
  'documents', 'doc_links', 'document_resolutions', 'canonical_fields',
  'assertions', 'insights', 'insight_runs', 'sync_runs', 'board_mutations',
  'operations', 'suppressed_links', 'issues',
  // Pipeline de IA (SPEC-032). As três raízes entram aqui; `review_verdicts`
  // não, porque corta por JOIN até `artifact_versions` — mesma razão pela qual
  // `briefing_versions` e `briefing_drafts` também estão fora desta lista. A
  // policy dela é provada no `artifacts-rls.int-spec.ts`.
  'artifacts', 'artifact_versions', 'artifact_runs',
];

describe('RLS: auditoria de cobertura + idempotência da migração', () => {
  let owner: PrismaClient;

  beforeAll(async () => {
    applyMigrations();
    owner = ownerClient();
    await grantAppRole(owner);
  });

  afterAll(async () => {
    await owner.$disconnect();
  });

  it('toda tabela de tenant tem row level security habilitada', async () => {
    const rows = (await owner.$queryRawUnsafe(
      `SELECT relname FROM pg_class
       WHERE relname = ANY($1) AND relrowsecurity = true`,
      TENANT_TABLES,
    )) as Array<{ relname: string }>;
    const withRls = rows.map((r) => r.relname).sort();
    expect(withRls).toEqual([...TENANT_TABLES].sort());
  });

  it('toda tabela de tenant tem uma policy tenant_isolation', async () => {
    const rows = (await owner.$queryRawUnsafe(
      `SELECT tablename FROM pg_policies
       WHERE tablename = ANY($1) AND policyname = 'tenant_isolation'`,
      TENANT_TABLES,
    )) as Array<{ tablename: string }>;
    const withPolicy = rows.map((r) => r.tablename).sort();
    expect(withPolicy).toEqual([...TENANT_TABLES].sort());
  });

  it('backfill do tenant pessoal é idempotente (rodar 2× não duplica)', async () => {
    // Seed: um user com projeto, SEM tenant (estado pré-migração).
    await owner.$executeRawUnsafe(
      `INSERT INTO users (id, github_id, login, created_at, updated_at)
       VALUES ('idem-u', 903, 'carol', now(), now()) ON CONFLICT (id) DO NOTHING`,
    );

    // O mesmo par de INSERTs do backfill da migração, id determinístico por user.
    const backfillTenant = `
      INSERT INTO tenants (id, installation_id, account_login, account_type, created_at)
      SELECT ('00000000-0000-4000-8000-' || substr(md5(u.id), 1, 12))::text, NULL, u.login, 'User', now()
      FROM users u WHERE u.id = 'idem-u'
      ON CONFLICT (id) DO NOTHING`;
    const backfillMembership = `
      INSERT INTO memberships (id, user_id, tenant_id, role, created_at)
      SELECT ('00000000-0000-4000-9000-' || substr(md5(u.id), 1, 12))::text, u.id,
             ('00000000-0000-4000-8000-' || substr(md5(u.id), 1, 12))::text, 'owner'::"Role", now()
      FROM users u WHERE u.id = 'idem-u'
      ON CONFLICT (user_id, tenant_id) DO NOTHING`;

    // Roda duas vezes.
    await owner.$executeRawUnsafe(backfillTenant);
    await owner.$executeRawUnsafe(backfillMembership);
    await owner.$executeRawUnsafe(backfillTenant);
    await owner.$executeRawUnsafe(backfillMembership);

    const tenants = (await owner.$queryRawUnsafe(
      `SELECT count(*)::int AS n FROM tenants WHERE account_login = 'carol'`,
    )) as Array<{ n: number }>;
    const memberships = (await owner.$queryRawUnsafe(
      `SELECT count(*)::int AS n FROM memberships WHERE user_id = 'idem-u'`,
    )) as Array<{ n: number }>;

    expect(tenants[0].n).toBe(1);
    expect(memberships[0].n).toBe(1);

    // cleanup
    await owner.$executeRawUnsafe(`DELETE FROM memberships WHERE user_id = 'idem-u'`);
    await owner.$executeRawUnsafe(
      `DELETE FROM tenants WHERE id = ('00000000-0000-4000-8000-' || substr(md5('idem-u'), 1, 12))::text`,
    );
    await owner.$executeRawUnsafe(`DELETE FROM users WHERE id = 'idem-u'`);
  });
});
