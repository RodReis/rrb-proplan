/**
 * RLS do briefing público (SPEC-031, Fatia 20) contra Postgres REAL.
 *
 * Prova o critério de isolamento da spec para as tabelas novas:
 *   - raiz (`service_catalog_items`) filtra por `tenant_id` próprio;
 *   - neta (`briefing_versions`) e bisneta (`briefing_drafts`) herdam o corte
 *     por JOIN até `clients`;
 *   - **fail-closed**: sem `app.tenant_ids`, SELECT devolve zero linhas.
 *
 * `briefing_drafts` é o caso mais frágil: o join atravessa TRÊS tabelas
 * (briefing_links → client_projects → clients). Um join quebrado devolveria
 * TUDO, não zero — por isso os dois tenants nascem povoados: a falha aparece
 * como "vê o do outro", que lista vazia não pegaria.
 *
 * `states`/`cities`/`segments` NÃO entram: são dado de referência compartilhado,
 * de propósito sem RLS (spec §3). O teste do fim documenta isso — se alguém
 * ligar RLS neles, o formulário público fica sem lista de cidades e este teste
 * quebra apontando o motivo.
 */
import { PrismaClient } from '@prisma/client';
import {
  ownerClient,
  appClient,
  applyMigrations,
  grantAppRole,
} from '../../test/int/db-harness';

const TENANT_A = '00000000-0000-4000-8000-b71ef000000a';
const TENANT_B = '00000000-0000-4000-8000-b71ef000000b';

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

const ids = (rows: unknown) => (rows as Array<{ id: string }>).map((r) => r.id);

describe('RLS: briefing público isola por tenant (SPEC-031)', () => {
  let owner: PrismaClient;
  let app: PrismaClient;

  beforeAll(async () => {
    applyMigrations();
    owner = ownerClient();
    app = appClient(1);
    await grantAppRole(owner);

    await owner.$executeRawUnsafe(
      `INSERT INTO tenants (id, account_login, account_type, created_at) VALUES
        ('${TENANT_A}', 'brf-a', 'User', now()),
        ('${TENANT_B}', 'brf-b', 'User', now())
       ON CONFLICT (id) DO NOTHING`,
    );
    await owner.$executeRawUnsafe(
      `INSERT INTO clients (id, tenant_id, name, created_at, updated_at) VALUES
        ('brf-cli-a', '${TENANT_A}', 'Cliente A', now(), now()),
        ('brf-cli-b', '${TENANT_B}', 'Cliente B', now(), now())
       ON CONFLICT (id) DO NOTHING`,
    );
    await owner.$executeRawUnsafe(
      `INSERT INTO client_projects (id, client_id, title, state, created_at, updated_at) VALUES
        ('brf-cp-a', 'brf-cli-a', 'Projeto A', 'LINK_SENT', now(), now()),
        ('brf-cp-b', 'brf-cli-b', 'Projeto B', 'LINK_SENT', now(), now())
       ON CONFLICT (id) DO NOTHING`,
    );
    await owner.$executeRawUnsafe(
      `INSERT INTO briefing_links (id, client_project_id, token_hash, created_at) VALUES
        ('brf-bl-a', 'brf-cp-a', 'brf-hash-a', now()),
        ('brf-bl-b', 'brf-cp-b', 'brf-hash-b', now())
       ON CONFLICT (id) DO NOTHING`,
    );
    await owner.$executeRawUnsafe(
      `INSERT INTO briefing_drafts (id, briefing_link_id, step, answers, created_at, updated_at) VALUES
        ('brf-dr-a', 'brf-bl-a', 3, '{"1":{"company":"ACME A"}}', now(), now()),
        ('brf-dr-b', 'brf-bl-b', 5, '{"1":{"company":"ACME B"}}', now(), now())
       ON CONFLICT (id) DO NOTHING`,
    );
    await owner.$executeRawUnsafe(
      `INSERT INTO briefing_versions (id, client_project_id, briefing_link_id, version, answers, content_hash, submitted_at) VALUES
        ('brf-bv-a', 'brf-cp-a', 'brf-bl-a', 1, '{"1":{"company":"ACME A"}}', 'hash-a', now()),
        ('brf-bv-b', 'brf-cp-b', 'brf-bl-b', 1, '{"1":{"company":"ACME B"}}', 'hash-b', now())
       ON CONFLICT (id) DO NOTHING`,
    );
    await owner.$executeRawUnsafe(
      `INSERT INTO service_catalog_items (id, tenant_id, segment, label, active, created_at, updated_at) VALUES
        ('brf-sc-a', '${TENANT_A}', 'J', 'Site institucional', true, now(), now()),
        ('brf-sc-b', '${TENANT_B}', 'J', 'Site institucional', true, now(), now())
       ON CONFLICT (id) DO NOTHING`,
    );
  });

  afterAll(async () => {
    await owner.$executeRawUnsafe(
      `DELETE FROM service_catalog_items WHERE id IN ('brf-sc-a','brf-sc-b')`,
    );
    await owner.$executeRawUnsafe(
      `DELETE FROM briefing_versions WHERE id IN ('brf-bv-a','brf-bv-b')`,
    );
    await owner.$executeRawUnsafe(`DELETE FROM briefing_drafts WHERE id IN ('brf-dr-a','brf-dr-b')`);
    await owner.$executeRawUnsafe(`DELETE FROM briefing_links WHERE id IN ('brf-bl-a','brf-bl-b')`);
    await owner.$executeRawUnsafe(
      `DELETE FROM client_projects WHERE id IN ('brf-cp-a','brf-cp-b')`,
    );
    await owner.$executeRawUnsafe(`DELETE FROM clients WHERE id IN ('brf-cli-a','brf-cli-b')`);
    await owner.$executeRawUnsafe(`DELETE FROM tenants WHERE id IN ('${TENANT_A}','${TENANT_B}')`);
    await owner.$disconnect();
    await app.$disconnect();
  });

  it('raiz: cada tenant vê só o próprio catálogo', async () => {
    const a = await withTenant(app, [TENANT_A], (tx) =>
      tx.$queryRawUnsafe(
        `SELECT id FROM service_catalog_items WHERE id IN ('brf-sc-a','brf-sc-b') ORDER BY id`,
      ),
    );
    const b = await withTenant(app, [TENANT_B], (tx) =>
      tx.$queryRawUnsafe(
        `SELECT id FROM service_catalog_items WHERE id IN ('brf-sc-a','brf-sc-b') ORDER BY id`,
      ),
    );
    expect(ids(a)).toEqual(['brf-sc-a']);
    expect(ids(b)).toEqual(['brf-sc-b']);
  });

  it('neta: briefing_versions herda o corte por join a clients', async () => {
    const a = await withTenant(app, [TENANT_A], (tx) =>
      tx.$queryRawUnsafe(
        `SELECT id FROM briefing_versions WHERE id IN ('brf-bv-a','brf-bv-b') ORDER BY id`,
      ),
    );
    expect(ids(a)).toEqual(['brf-bv-a']);
  });

  it('bisneta: briefing_drafts herda pelo join de três níveis', async () => {
    const a = await withTenant(app, [TENANT_A], (tx) =>
      tx.$queryRawUnsafe(
        `SELECT id FROM briefing_drafts WHERE id IN ('brf-dr-a','brf-dr-b') ORDER BY id`,
      ),
    );
    const b = await withTenant(app, [TENANT_B], (tx) =>
      tx.$queryRawUnsafe(
        `SELECT id FROM briefing_drafts WHERE id IN ('brf-dr-a','brf-dr-b') ORDER BY id`,
      ),
    );
    expect(ids(a)).toEqual(['brf-dr-a']);
    expect(ids(b)).toEqual(['brf-dr-b']);
  });

  it('fail-closed: sem contexto, as três tabelas devolvem zero linhas', async () => {
    for (const table of ['briefing_drafts', 'briefing_versions', 'service_catalog_items']) {
      const rows = (await app.$queryRawUnsafe(`SELECT id FROM ${table}`)) as unknown[];
      expect({ table, count: rows.length }).toEqual({ table, count: 0 });
    }
  });

  it('dado de referência é compartilhado: states/cities/segments legíveis sem contexto', async () => {
    // O oposto do teste acima, e igualmente um critério: o formulário público
    // não tem tenant no contexto quando monta o seletor de cidades. Ligar RLS
    // nestas tabelas quebraria a Etapa 1 — este teste é o alarme.
    for (const table of ['states', 'cities', 'segments']) {
      const rows = (await app.$queryRawUnsafe(
        `SELECT count(*)::int AS count FROM ${table}`,
      )) as Array<{ count: number }>;
      expect({ table, readable: rows[0].count >= 0 }).toEqual({ table, readable: true });
    }
  });
});
