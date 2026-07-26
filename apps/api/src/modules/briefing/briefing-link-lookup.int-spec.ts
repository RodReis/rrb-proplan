/**
 * Lookup do link público contra Postgres REAL (SPEC-029).
 *
 * Existe por causa de um bug que a suíte mockada não podia pegar: a rota
 * `GET /b/:token` roda **sem contexto de tenant** (não tem sessão), o RLS de
 * `briefing_links`/`clients` é fail-closed, e o SELECT direto voltava vazio —
 * **todo token válido respondia `invalid`**. O link público nunca funcionaria.
 *
 * O teste de service prova a LÓGICA sobre um `$queryRaw` mockado; o que faltava
 * era o ACESSO. Mesma classe de lacuna da issue #122 (teste correto sobre um
 * dado que não existe). Este spec fecha isso: usa a role `proplan_app`, sem
 * `app.tenant_ids`, exatamente como a rota pública em produção.
 */
import { PrismaClient } from '@prisma/client';
import { createHash } from 'node:crypto';
import { ownerClient, appClient, applyMigrations, grantAppRole } from '../../../test/int/db-harness';

const TENANT = '00000000-0000-4000-8000-b1e1f0000001';
const hash = (t: string) => createHash('sha256').update(t).digest('hex');

interface LinkRow {
  id: string;
  expires_at: Date | null;
  revoked_at: Date | null;
  tenant_id: string;
  client_project_id: string;
}

describe('resolve_briefing_link: lookup público sem contexto de tenant', () => {
  let owner: PrismaClient;
  let app: PrismaClient;

  beforeAll(async () => {
    applyMigrations();
    owner = ownerClient();
    app = appClient(1);
    await grantAppRole(owner);

    await owner.$executeRawUnsafe(
      `INSERT INTO tenants (id, account_login, account_type, created_at)
       VALUES ('${TENANT}', 'bl', 'User', now()) ON CONFLICT (id) DO NOTHING`,
    );
    await owner.$executeRawUnsafe(
      `INSERT INTO clients (id, tenant_id, name, created_at, updated_at) VALUES
        ('bl-c-viva', '${TENANT}', 'Cliente Vivo', now(), now()),
        ('bl-c-morta', '${TENANT}', 'Cliente Excluído', now(), now())
       ON CONFLICT (id) DO NOTHING`,
    );
    // Cliente excluído logicamente: o link dele tem de morrer junto.
    await owner.$executeRawUnsafe(
      `UPDATE clients SET deleted_at = now() WHERE id = 'bl-c-morta'`,
    );
    await owner.$executeRawUnsafe(
      `INSERT INTO client_projects (id, client_id, title, state, created_at, updated_at) VALUES
        ('bl-p-viva', 'bl-c-viva', 'Projeto Vivo', 'DRAFT', now(), now()),
        ('bl-p-morta', 'bl-c-morta', 'Projeto Órfão', 'DRAFT', now(), now())
       ON CONFLICT (id) DO NOTHING`,
    );
    await owner.$executeRawUnsafe(
      `INSERT INTO briefing_links (id, client_project_id, token_hash, created_at) VALUES
        ('bl-ok',      'bl-p-viva',  '${hash('token-valido')}',    now()),
        ('bl-revog',   'bl-p-viva',  '${hash('token-revogado')}',  now()),
        ('bl-expira',  'bl-p-viva',  '${hash('token-expirado')}',  now()),
        ('bl-orfao',   'bl-p-morta', '${hash('token-de-excluido')}', now())
       ON CONFLICT (id) DO NOTHING`,
    );
    await owner.$executeRawUnsafe(
      `UPDATE briefing_links SET revoked_at = now() WHERE id = 'bl-revog'`,
    );
    await owner.$executeRawUnsafe(
      `UPDATE briefing_links SET expires_at = now() - interval '1 day' WHERE id = 'bl-expira'`,
    );
  });

  afterAll(async () => {
    await owner.$executeRawUnsafe(
      `DELETE FROM briefing_links WHERE id IN ('bl-ok','bl-revog','bl-expira','bl-orfao')`,
    );
    await owner.$executeRawUnsafe(
      `DELETE FROM client_projects WHERE id IN ('bl-p-viva','bl-p-morta')`,
    );
    await owner.$executeRawUnsafe(
      `DELETE FROM clients WHERE id IN ('bl-c-viva','bl-c-morta')`,
    );
    await owner.$executeRawUnsafe(`DELETE FROM tenants WHERE id = '${TENANT}'`);
    await owner.$disconnect();
    await app.$disconnect();
  });

  const resolve = (token: string) =>
    app.$queryRawUnsafe<LinkRow[]>(
      `SELECT * FROM resolve_briefing_link('${hash(token)}')`,
    );

  it('SEM contexto de tenant, um token válido RESOLVE (era o bug)', async () => {
    // Este é o teste que faltava. Antes da função SECURITY DEFINER, o RLS
    // fail-closed devolvia 0 linhas aqui e a rota respondia `invalid` para
    // todo mundo.
    const rows = await resolve('token-valido');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: 'bl-ok',
      tenant_id: TENANT,
      client_project_id: 'bl-p-viva',
    });
  });

  it('o tenant sai do lookup — é dele que a auditoria depende', async () => {
    // A rota não recebe tenant nenhum; ele vem daqui (ADR-020).
    const [row] = await resolve('token-valido');
    expect(row.tenant_id).toBe(TENANT);
  });

  it('revogado e expirado ainda resolvem — quem decide o estado é o domínio', async () => {
    // A função devolve os carimbos; `linkStatus` os interpreta. Se ela filtrasse
    // revogado/expirado, a rota responderia `invalid` para os dois e o cliente
    // legítimo não saberia por que o link parou de funcionar.
    const [revogado] = await resolve('token-revogado');
    const [expirado] = await resolve('token-expirado');
    expect(revogado.revoked_at).toBeInstanceOf(Date);
    expect(expirado.expires_at).toBeInstanceOf(Date);
  });

  it('token inexistente não resolve', async () => {
    expect(await resolve('nunca-existiu')).toHaveLength(0);
  });

  it('exclusão lógica do cliente fecha o link público', async () => {
    // Sem este filtro, remover um cliente deixaria o link dele funcionando.
    expect(await resolve('token-de-excluido')).toHaveLength(0);
  });

  it('o RLS continua fechado: SELECT direto sem contexto segue vazio', async () => {
    // A função é a ÚNICA porta. Se este teste virar verde com linhas, alguém
    // afrouxou a policy e o isolamento multi-tenant caiu junto.
    const direct = await app.$queryRawUnsafe<unknown[]>(
      `SELECT id FROM briefing_links`,
    );
    expect(direct).toHaveLength(0);
  });
});
