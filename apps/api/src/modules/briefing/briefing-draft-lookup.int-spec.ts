/**
 * Rascunho do briefing contra Postgres REAL (SPEC-031).
 *
 * Existe pela mesma razão do `briefing-link-lookup.int-spec`: a rota
 * `PATCH /b/:token/draft` roda **sem contexto de tenant**, o RLS de
 * `briefing_drafts` é fail-closed, e um teste com `$queryRaw` mockado prova a
 * LÓGICA mas não o ACESSO. Foi assim que a SPEC-029 atravessou dois FIX.
 *
 * Aqui a role é `proplan_app`, sem `app.tenant_ids` — exatamente como a rota
 * pública em produção.
 */
import { PrismaClient } from '@prisma/client';
import { createHash } from 'node:crypto';
import {
  ownerClient,
  appClient,
  applyMigrations,
  grantAppRole,
} from '../../../test/int/db-harness';

const TENANT = '00000000-0000-4000-8000-d7a5f0000001';
const hash = (t: string) => createHash('sha256').update(t).digest('hex');

interface DraftRow {
  link_id: string;
  expires_at: Date | null;
  revoked_at: Date | null;
  tenant_id: string;
  client_project_id: string;
  project_state: string;
  draft_id: string | null;
  draft_step: number | null;
  draft_answers: Record<string, unknown> | null;
  draft_consumed_at: Date | null;
  version_count: number;
}

describe('resolve_briefing_draft: rascunho sem contexto de tenant', () => {
  let owner: PrismaClient;
  let app: PrismaClient;

  const resolve = (token: string) =>
    app.$queryRawUnsafe<DraftRow[]>(
      `SELECT * FROM resolve_briefing_draft('${hash(token)}')`,
    );

  beforeAll(async () => {
    applyMigrations();
    owner = ownerClient();
    app = appClient(1);
    await grantAppRole(owner);

    await owner.$executeRawUnsafe(
      `INSERT INTO tenants (id, account_login, account_type, created_at)
       VALUES ('${TENANT}', 'bd', 'User', now()) ON CONFLICT (id) DO NOTHING`,
    );
    await owner.$executeRawUnsafe(
      `INSERT INTO clients (id, tenant_id, name, created_at, updated_at)
       VALUES ('bd-cli', '${TENANT}', 'Cliente', now(), now())
       ON CONFLICT (id) DO NOTHING`,
    );
    await owner.$executeRawUnsafe(
      `INSERT INTO client_projects (id, client_id, title, state, created_at, updated_at) VALUES
        ('bd-novo', 'bd-cli', 'Sem rascunho', 'LINK_SENT', now(), now()),
        ('bd-meio', 'bd-cli', 'Com rascunho', 'BRIEFING_STARTED', now(), now()),
        ('bd-envi', 'bd-cli', 'Enviado', 'BRIEFING_SUBMITTED', now(), now())
       ON CONFLICT (id) DO NOTHING`,
    );
    await owner.$executeRawUnsafe(
      `INSERT INTO briefing_links (id, client_project_id, token_hash, created_at) VALUES
        ('bd-l-novo', 'bd-novo', '${hash('tok-novo')}', now()),
        ('bd-l-meio', 'bd-meio', '${hash('tok-meio')}', now()),
        ('bd-l-envi', 'bd-envi', '${hash('tok-envi')}', now())
       ON CONFLICT (id) DO NOTHING`,
    );
    await owner.$executeRawUnsafe(
      `INSERT INTO briefing_drafts (id, briefing_link_id, step, answers, created_at, updated_at) VALUES
        ('bd-d-meio', 'bd-l-meio', 4, '{"1":{"company":"ACME"}}', now(), now())
       ON CONFLICT (id) DO NOTHING`,
    );
    await owner.$executeRawUnsafe(
      `INSERT INTO briefing_versions (id, client_project_id, briefing_link_id, version, answers, content_hash, submitted_at) VALUES
        ('bd-v-envi', 'bd-envi', 'bd-l-envi', 1, '{"1":{"company":"X"}}', 'h1', now())
       ON CONFLICT (id) DO NOTHING`,
    );
  });

  afterAll(async () => {
    await owner.$executeRawUnsafe(`DELETE FROM briefing_versions WHERE id = 'bd-v-envi'`);
    await owner.$executeRawUnsafe(`DELETE FROM briefing_drafts WHERE id = 'bd-d-meio'`);
    await owner.$executeRawUnsafe(
      `DELETE FROM briefing_links WHERE id IN ('bd-l-novo','bd-l-meio','bd-l-envi')`,
    );
    await owner.$executeRawUnsafe(
      `DELETE FROM client_projects WHERE id IN ('bd-novo','bd-meio','bd-envi')`,
    );
    await owner.$executeRawUnsafe(`DELETE FROM clients WHERE id = 'bd-cli'`);
    await owner.$executeRawUnsafe(`DELETE FROM tenants WHERE id = '${TENANT}'`);
    await owner.$disconnect();
    await app.$disconnect();
  });

  it('link SEM rascunho resolve mesmo assim (LEFT JOIN, não INNER)', async () => {
    // O bug que um INNER JOIN causaria: todo link novo — o caso mais comum —
    // responderia `invalid` e o formulário nunca abriria.
    const [row] = await resolve('tok-novo');
    expect(row).toBeDefined();
    expect(row.client_project_id).toBe('bd-novo');
    expect(row.draft_id).toBeNull();
    expect(row.version_count).toBe(0);
  });

  it('link COM rascunho devolve etapa e respostas', async () => {
    const [row] = await resolve('tok-meio');
    expect(row.draft_step).toBe(4);
    expect(row.draft_answers).toEqual({ 1: { company: 'ACME' } });
    expect(row.project_state).toBe('BRIEFING_STARTED');
  });

  it('link já enviado conta a versão (o formulário não reabre)', async () => {
    const [row] = await resolve('tok-envi');
    expect(row.version_count).toBe(1);
  });

  it('token inexistente devolve zero linhas', async () => {
    expect(await resolve('nao-existe')).toHaveLength(0);
  });

  it('a rota pública NÃO enxerga as tabelas fora da função (RLS intacto)', async () => {
    // A função é SECURITY DEFINER; o resto continua fail-closed. Se alguém
    // trocar a policy por um default permissivo, este teste quebra.
    for (const table of ['briefing_drafts', 'briefing_versions', 'briefing_links']) {
      const rows = (await app.$queryRawUnsafe(`SELECT id FROM ${table}`)) as unknown[];
      expect({ table, count: rows.length }).toEqual({ table, count: 0 });
    }
  });

  it('escrita do rascunho funciona sob o contexto do tenant descoberto', async () => {
    // O caminho real do `saveDraft`: descobre o tenant pelo hash e abre o
    // contexto só então. Sem o contexto, o INSERT é barrado pela policy.
    const [row] = await resolve('tok-novo');

    await app.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(
        `SELECT set_config('app.tenant_ids', '{${row.tenant_id}}', true)`,
      );
      await tx.$executeRawUnsafe(
        `INSERT INTO briefing_drafts (id, briefing_link_id, step, answers, created_at, updated_at)
         VALUES ('bd-d-novo', '${row.link_id}', 2, '{"1":{"company":"Nova"}}', now(), now())`,
      );
    });

    const [depois] = await resolve('tok-novo');
    expect(depois.draft_step).toBe(2);

    await owner.$executeRawUnsafe(`DELETE FROM briefing_drafts WHERE id = 'bd-d-novo'`);
  });

  it('SEM contexto de tenant, a escrita é barrada pela policy', async () => {
    const [row] = await resolve('tok-novo');
    await expect(
      app.$executeRawUnsafe(
        `INSERT INTO briefing_drafts (id, briefing_link_id, step, answers, created_at, updated_at)
         VALUES ('bd-d-vaza', '${row.link_id}', 1, '{}', now(), now())`,
      ),
    ).rejects.toThrow();
  });
});
