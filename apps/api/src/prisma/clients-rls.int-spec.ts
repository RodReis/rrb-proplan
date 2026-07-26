/**
 * RLS da Frente Clientes (SPEC-029, Fatia 19) contra Postgres REAL.
 *
 * Prova os critérios de aceite de isolamento da spec para as tabelas novas:
 *   - raiz (`clients`, `audit_events`) filtra por `tenant_id`;
 *   - filha (`client_projects`) e netas (`client_status_transitions`,
 *     `briefing_links`) herdam o corte por JOIN até a raiz;
 *   - **fail-closed**: sem `app.tenant_ids` no contexto, SELECT devolve zero
 *     linhas (é o critério "com o role de aplicação e sem contexto, SELECT
 *     direto em clients/client_projects devolve zero linhas").
 *
 * As netas são o ponto que um teste ingênuo deixaria passar: elas não têm
 * `tenant_id` próprio, então a policy delas depende do join estar certo. Um
 * join quebrado devolveria TUDO, não zero — falha silenciosa que só um teste
 * com dois tenants povoados pega.
 */
import { PrismaClient } from '@prisma/client';
import {
  ownerClient,
  appClient,
  applyMigrations,
  grantAppRole,
} from '../../test/int/db-harness';

const TENANT_A = '00000000-0000-4000-8000-c1e47000000a';
const TENANT_B = '00000000-0000-4000-8000-c1e47000000b';

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

describe('RLS: Frente Clientes isola por tenant (SPEC-029)', () => {
  let owner: PrismaClient;
  let app: PrismaClient;

  beforeAll(async () => {
    applyMigrations();
    owner = ownerClient();
    app = appClient(1);
    await grantAppRole(owner);

    await owner.$executeRawUnsafe(
      `INSERT INTO tenants (id, account_login, account_type, created_at) VALUES
        ('${TENANT_A}', 'cli-a', 'User', now()),
        ('${TENANT_B}', 'cli-b', 'User', now())
       ON CONFLICT (id) DO NOTHING`,
    );
    // Um cliente por tenant, cada um com projeto, transição e link — para que
    // um join quebrado apareça como "vê o do outro", não como lista vazia.
    await owner.$executeRawUnsafe(
      `INSERT INTO clients (id, tenant_id, name, company, created_at, updated_at) VALUES
        ('cli-a', '${TENANT_A}', 'Cliente A', 'ACME A', now(), now()),
        ('cli-b', '${TENANT_B}', 'Cliente B', 'ACME B', now(), now())
       ON CONFLICT (id) DO NOTHING`,
    );
    await owner.$executeRawUnsafe(
      `INSERT INTO client_projects (id, client_id, title, state, created_at, updated_at) VALUES
        ('cp-a', 'cli-a', 'Projeto A', 'DRAFT', now(), now()),
        ('cp-b', 'cli-b', 'Projeto B', 'DRAFT', now(), now())
       ON CONFLICT (id) DO NOTHING`,
    );
    await owner.$executeRawUnsafe(
      `INSERT INTO client_status_transitions (id, client_project_id, from_state, to_state, at) VALUES
        ('tr-a', 'cp-a', 'DRAFT', 'LINK_SENT', now()),
        ('tr-b', 'cp-b', 'DRAFT', 'LINK_SENT', now())
       ON CONFLICT (id) DO NOTHING`,
    );
    await owner.$executeRawUnsafe(
      `INSERT INTO briefing_links (id, client_project_id, token_hash, created_at) VALUES
        ('bl-a', 'cp-a', 'hash-a', now()),
        ('bl-b', 'cp-b', 'hash-b', now())
       ON CONFLICT (id) DO NOTHING`,
    );
    await owner.$executeRawUnsafe(
      `INSERT INTO audit_events (id, tenant_id, kind, subject, at) VALUES
        ('ae-a', '${TENANT_A}', 'briefing_link.created', 'cp-a', now()),
        ('ae-b', '${TENANT_B}', 'briefing_link.created', 'cp-b', now())
       ON CONFLICT (id) DO NOTHING`,
    );
  });

  afterAll(async () => {
    await owner.$executeRawUnsafe(`DELETE FROM audit_events WHERE id IN ('ae-a','ae-b')`);
    await owner.$executeRawUnsafe(`DELETE FROM briefing_links WHERE id IN ('bl-a','bl-b')`);
    await owner.$executeRawUnsafe(
      `DELETE FROM client_status_transitions WHERE id IN ('tr-a','tr-b')`,
    );
    await owner.$executeRawUnsafe(`DELETE FROM client_projects WHERE id IN ('cp-a','cp-b')`);
    await owner.$executeRawUnsafe(`DELETE FROM clients WHERE id IN ('cli-a','cli-b')`);
    await owner.$executeRawUnsafe(
      `DELETE FROM tenants WHERE id IN ('${TENANT_A}','${TENANT_B}')`,
    );
    await owner.$disconnect();
    await app.$disconnect();
  });

  it('raiz: cada tenant vê só o próprio cliente', async () => {
    const a = await withTenant(app, [TENANT_A], (tx) =>
      tx.$queryRawUnsafe(`SELECT id FROM clients WHERE id IN ('cli-a','cli-b') ORDER BY id`),
    );
    const b = await withTenant(app, [TENANT_B], (tx) =>
      tx.$queryRawUnsafe(`SELECT id FROM clients WHERE id IN ('cli-a','cli-b') ORDER BY id`),
    );
    expect(ids(a)).toEqual(['cli-a']);
    expect(ids(b)).toEqual(['cli-b']);
  });

  it('filha: client_projects herda o corte por join a clients', async () => {
    const a = await withTenant(app, [TENANT_A], (tx) =>
      tx.$queryRawUnsafe(`SELECT id FROM client_projects WHERE id IN ('cp-a','cp-b') ORDER BY id`),
    );
    expect(ids(a)).toEqual(['cp-a']);
  });

  it('netas: transições e links herdam o corte pelo join até clients', async () => {
    const transitions = await withTenant(app, [TENANT_A], (tx) =>
      tx.$queryRawUnsafe(
        `SELECT id FROM client_status_transitions WHERE id IN ('tr-a','tr-b') ORDER BY id`,
      ),
    );
    const links = await withTenant(app, [TENANT_A], (tx) =>
      tx.$queryRawUnsafe(`SELECT id FROM briefing_links WHERE id IN ('bl-a','bl-b') ORDER BY id`),
    );
    expect(ids(transitions)).toEqual(['tr-a']);
    expect(ids(links)).toEqual(['bl-a']);
  });

  it('audit_events isola por tenant_id próprio', async () => {
    const a = await withTenant(app, [TENANT_A], (tx) =>
      tx.$queryRawUnsafe(`SELECT id FROM audit_events WHERE id IN ('ae-a','ae-b') ORDER BY id`),
    );
    expect(ids(a)).toEqual(['ae-a']);
  });

  it('array de membership: contexto com A e B vê os dois (rota global)', async () => {
    const both = await withTenant(app, [TENANT_A, TENANT_B], (tx) =>
      tx.$queryRawUnsafe(`SELECT id FROM clients WHERE id IN ('cli-a','cli-b') ORDER BY id`),
    );
    expect(ids(both)).toEqual(['cli-a', 'cli-b']);
  });

  it('fail-closed: sem contexto, as cinco tabelas devolvem zero linhas', async () => {
    // Sem withTenant: `app.tenant_ids` não está setado. NULLIF(...) vira NULL,
    // `= ANY(NULL)` é NULL, e a policy não casa nada. Se alguém trocar a policy
    // por um default permissivo, este teste quebra.
    for (const table of [
      'clients',
      'client_projects',
      'client_status_transitions',
      'briefing_links',
      'audit_events',
    ]) {
      const rows = (await app.$queryRawUnsafe(`SELECT id FROM ${table}`)) as unknown[];
      expect({ table, count: rows.length }).toEqual({ table, count: 0 });
    }
  });
});
