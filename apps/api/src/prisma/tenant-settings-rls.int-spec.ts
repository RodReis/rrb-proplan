/**
 * `tenant_settings` (ADR-026) contra Postgres REAL — isolamento e a regra de
 * desempate do backfill.
 *
 * Duas coisas que só o banco prova:
 *
 * 1. **Isolamento fail-closed.** É a razão de o teto ter saído de `settings`:
 *    o gate passou a ser chamável de job sem sessão, e sem contexto o SELECT
 *    devolve ZERO — que num teto significaria "o mês custou 0", não "erro".
 *    O `capsOf` abre o próprio contexto justamente por isso.
 *
 * 2. **O backfill escolhe o teto do `owner` mais antigo** (decisão 3 do
 *    ADR-026). É uma migração destrutiva por decisão: os tetos de não-`owner`
 *    somem. Um desempate errado aqui não quebra nada visível — só faz o tenant
 *    herdar em silêncio o limite da pessoa errada, e ninguém descobre até a
 *    fatura. Por isso a query do backfill é re-executada aqui sobre fixtures
 *    controladas, em vez de confiar que a migração "passou".
 */
import { PrismaClient } from '@prisma/client';
import {
  ownerClient,
  appClient,
  applyMigrations,
  grantAppRole,
} from '../../test/int/db-harness';

const TENANT_A = '00000000-0000-4000-8000-caa5e0000001';
const TENANT_B = '00000000-0000-4000-8000-caa5e0000002';

/** Mesma mecânica do `PrismaService.withTenant` sobre um client arbitrário. */
async function withTenant<T>(
  client: PrismaClient,
  tenantIds: string[],
  fn: (tx: PrismaClient) => Promise<T>,
): Promise<T> {
  const arrayLiteral = `{${tenantIds.join(',')}}`;
  return client.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.tenant_ids', ${arrayLiteral}, true)`;
    return fn(tx as unknown as PrismaClient);
  });
}

describe('tenant_settings: isolamento e backfill do teto (ADR-026)', () => {
  let owner: PrismaClient;
  let app: PrismaClient;

  beforeAll(async () => {
    applyMigrations();
    owner = ownerClient();
    app = appClient(1);
    await grantAppRole(owner);

    for (const [id, login] of [
      [TENANT_A, 'caps-a'],
      [TENANT_B, 'caps-b'],
    ]) {
      await owner.$executeRawUnsafe(
        `INSERT INTO tenants (id, installation_id, account_login, account_type, created_at)
         VALUES ($1, NULL, $2, 'User', now()) ON CONFLICT (id) DO NOTHING`,
        id,
        login,
      );
      await owner.$executeRawUnsafe(
        `INSERT INTO tenant_settings (id, tenant_id, llm_alert_usd_monthly, llm_hard_cap_usd_monthly, updated_at)
         VALUES ($1, $2, 3, 11, now()) ON CONFLICT (tenant_id) DO NOTHING`,
        `ts-${login}`,
        id,
      );
    }
  });

  afterAll(async () => {
    await owner.$executeRawUnsafe(`DELETE FROM tenant_settings WHERE tenant_id = ANY($1)`, [
      TENANT_A,
      TENANT_B,
    ]);
    await owner.$executeRawUnsafe(`DELETE FROM tenants WHERE id = ANY($1)`, [TENANT_A, TENANT_B]);
    await owner.$disconnect();
    await app.$disconnect();
  });

  it('sem contexto de tenant, SELECT devolve zero linhas (fail-closed)', async () => {
    const rows = (await app.$queryRawUnsafe(
      `SELECT tenant_id FROM tenant_settings`,
    )) as unknown[];
    expect(rows).toHaveLength(0);
  });

  it('com contexto, o tenant só enxerga o próprio teto', async () => {
    const rows = await withTenant(app, [TENANT_A], (tx) =>
      tx.$queryRawUnsafe(`SELECT tenant_id FROM tenant_settings`),
    );
    expect(rows).toEqual([{ tenant_id: TENANT_A }]);
  });

  it('um tenant não tem dois tetos — o UNIQUE recusa', async () => {
    // O estado exato de que o ADR-026 nos tira: dois tetos sobre a mesma soma.
    // Antes vinha de graça (`settings.user_id` UNIQUE, um por pessoa); agora o
    // banco recusa em vez de confiar que o código não crie.
    await expect(
      owner.$executeRawUnsafe(
        `INSERT INTO tenant_settings (id, tenant_id, updated_at) VALUES ('ts-dup', $1, now())`,
        TENANT_A,
      ),
    ).rejects.toThrow();
  });

  it('teto negativo é recusado pelo CHECK', async () => {
    await expect(
      owner.$executeRawUnsafe(
        `INSERT INTO tenant_settings (id, tenant_id, llm_hard_cap_usd_monthly, updated_at)
         VALUES ('ts-neg', $1, -1, now())`,
        TENANT_B,
      ),
    ).rejects.toThrow();
  });
});

/**
 * A query de backfill da migração, re-executada sobre fixtures. Copiada da
 * migration `20260727150000_adr_026_tenant_settings` — se as duas divergirem,
 * este teste para de provar o que diz provar, e é por isso que ele afirma o
 * desempate e não só "alguma linha nasceu".
 */
describe('backfill do ADR-026: vence o teto do owner mais antigo', () => {
  let owner: PrismaClient;

  const T = '00000000-0000-4000-8000-caa5e0000003';
  const OWNER_VELHO = 'bf-owner-velho';
  const OWNER_NOVO = 'bf-owner-novo';
  const MEMBRO = 'bf-membro';

  beforeAll(async () => {
    applyMigrations();
    owner = ownerClient();

    // O cenário PRÉ-migração vive aqui: `settings` já não tem as colunas de
    // teto (a migração as dropou), então a fixture reproduz o formato antigo.
    // Tabela normal, não TEMP: o Prisma usa conexões de pool e uma TEMP some
    // junto com a sessão que a criou.
    await owner.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS bf_settings_legacy (
        user_id text PRIMARY KEY,
        llm_alert_usd_monthly numeric(10,4),
        llm_hard_cap_usd_monthly numeric(10,4)
      )`);
    await owner.$executeRawUnsafe(`DELETE FROM bf_settings_legacy`);

    await owner.$executeRawUnsafe(
      `INSERT INTO tenants (id, installation_id, account_login, account_type, created_at)
       VALUES ($1, NULL, 'bf-tenant', 'Organization', now()) ON CONFLICT (id) DO NOTHING`,
      T,
    );

    // Três membros, três tetos diferentes. Só um deles pode vencer.
    const fixtures: Array<[string, string, string, string, number]> = [
      // [userId, githubId, role, createdAt, hardCap]
      [OWNER_NOVO, '9001', 'owner', '2026-03-01', 77],
      [OWNER_VELHO, '9002', 'owner', '2026-01-01', 42],
      [MEMBRO, '9003', 'member', '2025-01-01', 999],
    ];
    for (const [uid, gh, role, created, cap] of fixtures) {
      await owner.$executeRawUnsafe(
        `INSERT INTO users (id, github_id, login, created_at, updated_at)
         VALUES ($1, $2::bigint, $1, now(), now()) ON CONFLICT (id) DO NOTHING`,
        uid,
        gh,
      );
      await owner.$executeRawUnsafe(
        `INSERT INTO memberships (id, user_id, tenant_id, role, created_at)
         VALUES ($1, $2, $3, $4::"Role", $5::timestamp) ON CONFLICT (user_id, tenant_id) DO NOTHING`,
        `m-${uid}`,
        uid,
        T,
        role,
        created,
      );
      await owner.$executeRawUnsafe(
        `INSERT INTO bf_settings_legacy (user_id, llm_alert_usd_monthly, llm_hard_cap_usd_monthly)
         VALUES ($1, 1, $2)`,
        uid,
        cap,
      );
    }
  });

  afterAll(async () => {
    await owner.$executeRawUnsafe(`DROP TABLE IF EXISTS bf_settings_legacy`);
    await owner.$executeRawUnsafe(`DELETE FROM tenant_settings WHERE tenant_id = $1`, T);
    await owner.$executeRawUnsafe(`DELETE FROM memberships WHERE tenant_id = $1`, T);
    await owner.$executeRawUnsafe(`DELETE FROM tenants WHERE id = $1`, T);
    await owner.$executeRawUnsafe(`DELETE FROM users WHERE id = ANY($1)`, [
      OWNER_VELHO,
      OWNER_NOVO,
      MEMBRO,
    ]);
    await owner.$disconnect();
  });

  it('escolhe o owner de membership mais antiga, ignorando o member de teto maior', async () => {
    const rows = (await owner.$queryRawUnsafe(
      `SELECT COALESCE(s."llm_hard_cap_usd_monthly", 20) AS cap
       FROM tenants t
       LEFT JOIN LATERAL (
         SELECT s2."llm_hard_cap_usd_monthly"
         FROM bf_settings_legacy s2
         JOIN memberships m ON m."user_id" = s2."user_id" AND m."tenant_id" = t."id"
         WHERE m."role" = 'owner'
         ORDER BY m."created_at" ASC, s2."user_id" ASC
         LIMIT 1
       ) s ON TRUE
       WHERE t."id" = $1`,
      T,
    )) as Array<{ cap: unknown }>;

    // 42 = owner de janeiro. NÃO 77 (owner de março) e NÃO 999 (member, cujo
    // teto era o maior — a armadilha de um backfill que só pegasse o máximo).
    expect(Number(rows[0].cap)).toBe(42);
  });

  it('tenant sem owner cai no DEFAULT do schema, não em NULL', async () => {
    const SEM_OWNER = '00000000-0000-4000-8000-caa5e0000004';
    await owner.$executeRawUnsafe(
      `INSERT INTO tenants (id, installation_id, account_login, account_type, created_at)
       VALUES ($1, NULL, 'bf-sem-owner', 'Organization', now()) ON CONFLICT (id) DO NOTHING`,
      SEM_OWNER,
    );
    const rows = (await owner.$queryRawUnsafe(
      `SELECT COALESCE(s."llm_hard_cap_usd_monthly", 20) AS cap
       FROM tenants t
       LEFT JOIN LATERAL (
         SELECT s2."llm_hard_cap_usd_monthly"
         FROM bf_settings_legacy s2
         JOIN memberships m ON m."user_id" = s2."user_id" AND m."tenant_id" = t."id"
         WHERE m."role" = 'owner'
         ORDER BY m."created_at" ASC, s2."user_id" ASC
         LIMIT 1
       ) s ON TRUE
       WHERE t."id" = $1`,
      SEM_OWNER,
    )) as Array<{ cap: unknown }>;
    expect(Number(rows[0].cap)).toBe(20);
    await owner.$executeRawUnsafe(`DELETE FROM tenants WHERE id = $1`, SEM_OWNER);
  });
});
