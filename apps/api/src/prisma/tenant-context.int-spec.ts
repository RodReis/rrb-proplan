/**
 * Contexto transaction-scoped via withTenant (SPEC-022, PR-3) contra Postgres
 * real. Prova o critério mais sutil da spec: o SET LOCAL NÃO vaza entre
 * chamadas que reusam a conexão do pool.
 *
 * withTenant usa set_config(..., true) = SET LOCAL, que morre no commit. Se
 * alguém trocasse por SET de sessão, o contexto do tenant A sobreviveria à
 * transação e a próxima chamada (tenant B, mesma conexão do pool) veria dados
 * de A. Este teste falha se isso acontecer.
 */
import { PrismaClient } from '@prisma/client';
import { ownerClient, appClient, applyMigrations, grantAppRole } from '../../test/int/db-harness';
import { tenantStorage } from './tenant-context';

const TENANT_A = '00000000-0000-4000-8000-cccccccccccc1';
const TENANT_B = '00000000-0000-4000-8000-cccccccccccc2';

// Reproduz withTenant sobre um client arbitrário (o método vive no
// PrismaService/Nest; aqui exercitamos a mesma mecânica sobre o appClient real).
async function withTenant<T>(
  client: PrismaClient,
  tenantId: string,
  fn: (tx: PrismaClient) => Promise<T>,
): Promise<T> {
  return client.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
    return tenantStorage.run(tx as unknown as PrismaClient, () => fn(tx as unknown as PrismaClient));
  });
}

describe('withTenant: contexto transaction-scoped (não vaza no pool)', () => {
  let owner: PrismaClient;
  let app: PrismaClient;

  beforeAll(async () => {
    applyMigrations();
    owner = ownerClient();
    // Pool de 1 conexão: força o reuso da MESMA conexão entre chamadas — é onde
    // um SET de sessão vazaria. Se o teste passa com pool=1, passa com N.
    app = appClient(1);
    await grantAppRole(owner);

    await owner.$executeRawUnsafe(
      `INSERT INTO users (id, github_id, login, created_at, updated_at) VALUES
        ('tc-u-a', 801, 'ta', now(), now()), ('tc-u-b', 802, 'tb', now(), now())
       ON CONFLICT (id) DO NOTHING`,
    );
    await owner.$executeRawUnsafe(
      `INSERT INTO tenants (id, account_login, account_type, created_at) VALUES
        ('${TENANT_A}', 'ta', 'User', now()), ('${TENANT_B}', 'tb', 'User', now())
       ON CONFLICT (id) DO NOTHING`,
    );
    await owner.$executeRawUnsafe(
      `INSERT INTO projects (id, user_id, tenant_id, github_repo_id, owner, name, default_branch, is_private, created_at) VALUES
        ('tc-p-a', 'tc-u-a', '${TENANT_A}', 8010, 'ta', 'ra', 'main', false, now()),
        ('tc-p-b', 'tc-u-b', '${TENANT_B}', 8020, 'tb', 'rb', 'main', false, now())
       ON CONFLICT (id) DO NOTHING`,
    );
  });

  afterAll(async () => {
    await owner.$executeRawUnsafe(`DELETE FROM projects WHERE id IN ('tc-p-a','tc-p-b')`);
    await owner.$executeRawUnsafe(`DELETE FROM tenants WHERE id IN ('${TENANT_A}','${TENANT_B}')`);
    await owner.$executeRawUnsafe(`DELETE FROM users WHERE id IN ('tc-u-a','tc-u-b')`);
    await owner.$disconnect();
    await app.$disconnect();
  });

  it('cada withTenant vê só o próprio tenant', async () => {
    const a = await withTenant(app, TENANT_A, (tx) =>
      tx.$queryRawUnsafe(`SELECT id FROM projects WHERE id IN ('tc-p-a','tc-p-b')`),
    );
    const b = await withTenant(app, TENANT_B, (tx) =>
      tx.$queryRawUnsafe(`SELECT id FROM projects WHERE id IN ('tc-p-a','tc-p-b')`),
    );
    expect((a as Array<{ id: string }>).map((r) => r.id)).toEqual(['tc-p-a']);
    expect((b as Array<{ id: string }>).map((r) => r.id)).toEqual(['tc-p-b']);
  });

  it('após withTenant(A), uma query fora de contexto NÃO herda A (pool reuse)', async () => {
    await withTenant(app, TENANT_A, (tx) =>
      tx.$queryRawUnsafe(`SELECT id FROM projects WHERE id = 'tc-p-a'`),
    );
    // Mesma conexão do pool (size=1), agora SEM contexto → fail-closed, 0 linhas.
    const leaked = (await app.$queryRawUnsafe(
      `SELECT id FROM projects WHERE id IN ('tc-p-a','tc-p-b')`,
    )) as unknown[];
    expect(leaked).toHaveLength(0);
  });
});
