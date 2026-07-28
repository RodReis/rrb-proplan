/**
 * As quatro tabelas da SPEC-032 contra Postgres REAL: isolamento e o índice
 * parcial de idempotência.
 *
 * Três coisas que só o banco prova, e todas as três são silenciosas quando
 * quebram — que é o motivo de existir int-spec aqui em vez de mock:
 *
 * 1. **Fail-closed sem contexto.** O pipeline roda em JOB, sem request. Ler ou
 *    gravar sem `runInTenantContext` não dá erro — dá ZERO LINHAS, e um
 *    pipeline que gravou zero artefatos tem a mesma cara de um bem-sucedido do
 *    lado de fora. Esta frente já acumulou 5 ocorrências desta classe.
 *
 * 2. **`review_verdicts` corta por JOIN**, não por coluna própria. É a única
 *    das quatro que não é raiz, então é a única cuja policy pode estar certa na
 *    forma e errada no alcance.
 *
 * 3. **O índice parcial** (§7.4.2) é `WHERE author = 'ai'`. Um índice sem o
 *    `WHERE` passaria em qualquer teste que só inserisse versões da IA — o caso
 *    que o distingue é justamente o par de edições humanas, que precisa ser
 *    ACEITO.
 */
import { PrismaClient } from '@prisma/client';
import { ownerClient, appClient, applyMigrations, grantAppRole } from '../../test/int/db-harness';

const TENANT_A = '00000000-0000-4000-8000-a47ifac70001';
const TENANT_B = '00000000-0000-4000-8000-a47ifac70002';

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

describe('SPEC-032: isolamento das tabelas de artefato', () => {
  let owner: PrismaClient;
  let app: PrismaClient;

  // Um projeto de cliente por tenant, com um briefing enviado — o insumo real
  // do pipeline. Sem isso as FKs não fecham e o teste provaria menos do que diz.
  const fixtures = [
    { tenant: TENANT_A, sufixo: 'a' },
    { tenant: TENANT_B, sufixo: 'b' },
  ];

  beforeAll(async () => {
    applyMigrations();
    owner = ownerClient();
    app = appClient(1);
    await grantAppRole(owner);

    for (const { tenant, sufixo } of fixtures) {
      await owner.$executeRawUnsafe(
        `INSERT INTO tenants (id, installation_id, account_login, account_type, created_at)
         VALUES ($1, NULL, $2, 'User', now()) ON CONFLICT (id) DO NOTHING`,
        tenant,
        `art-${sufixo}`,
      );
      await owner.$executeRawUnsafe(
        `INSERT INTO clients (id, tenant_id, name, created_at, updated_at)
         VALUES ($1, $2, 'Cliente', now(), now()) ON CONFLICT (id) DO NOTHING`,
        `cli-${sufixo}`,
        tenant,
      );
      await owner.$executeRawUnsafe(
        `INSERT INTO client_projects (id, client_id, title, state, created_at, updated_at)
         VALUES ($1, $2, 'Projeto', 'BRIEFING_SUBMITTED', now(), now()) ON CONFLICT (id) DO NOTHING`,
        `cp-${sufixo}`,
        `cli-${sufixo}`,
      );
      await owner.$executeRawUnsafe(
        `INSERT INTO briefing_links (id, client_project_id, token_hash, created_at)
         VALUES ($1, $2, $3, now()) ON CONFLICT (id) DO NOTHING`,
        `bl-${sufixo}`,
        `cp-${sufixo}`,
        `hash-${sufixo}`,
      );
      await owner.$executeRawUnsafe(
        `INSERT INTO briefing_versions (id, client_project_id, briefing_link_id, version, answers, content_hash, submitted_at)
         VALUES ($1, $2, $3, 1, '{}'::jsonb, $4, now()) ON CONFLICT (id) DO NOTHING`,
        `bv-${sufixo}`,
        `cp-${sufixo}`,
        `bl-${sufixo}`,
        `ch-${sufixo}`,
      );
      await owner.$executeRawUnsafe(
        `INSERT INTO artifact_runs (id, tenant_id, client_project_id, briefing_version_id, status, completed_kinds, started_at)
         VALUES ($1, $2, $3, $4, 'RUNNING', '{}', now()) ON CONFLICT (id) DO NOTHING`,
        `run-${sufixo}`,
        tenant,
        `cp-${sufixo}`,
        `bv-${sufixo}`,
      );
      await owner.$executeRawUnsafe(
        `INSERT INTO artifacts (id, tenant_id, client_project_id, kind, state, created_at, updated_at)
         VALUES ($1, $2, $3, 'scope', 'PENDING_REVIEW', now(), now()) ON CONFLICT (id) DO NOTHING`,
        `art-${sufixo}`,
        tenant,
        `cp-${sufixo}`,
      );
      await owner.$executeRawUnsafe(
        `INSERT INTO artifact_versions (id, tenant_id, artifact_id, version, content, author, input_hash, artifact_run_id, created_at)
         VALUES ($1, $2, $3, 1, '{"escopo":"x"}'::jsonb, 'ai', $4, $5, now()) ON CONFLICT (id) DO NOTHING`,
        `av-${sufixo}`,
        tenant,
        `art-${sufixo}`,
        `ih-${sufixo}`,
        `run-${sufixo}`,
      );
      await owner.$executeRawUnsafe(
        `INSERT INTO review_verdicts (id, artifact_version_id, verdict, rationale, created_at)
         VALUES ($1, $2, 'atencao', 'faltou detalhar prazo', now()) ON CONFLICT (id) DO NOTHING`,
        `rv-${sufixo}`,
        `av-${sufixo}`,
      );
    }
  });

  afterAll(async () => {
    // Ordem inversa das FKs; `clients` leva `client_projects` no cascade.
    await owner.$executeRawUnsafe(`DELETE FROM review_verdicts WHERE id = ANY($1)`, ['rv-a', 'rv-b']);
    await owner.$executeRawUnsafe(`DELETE FROM artifact_versions WHERE tenant_id = ANY($1)`, [TENANT_A, TENANT_B]);
    await owner.$executeRawUnsafe(`DELETE FROM artifacts WHERE tenant_id = ANY($1)`, [TENANT_A, TENANT_B]);
    await owner.$executeRawUnsafe(`DELETE FROM artifact_runs WHERE tenant_id = ANY($1)`, [TENANT_A, TENANT_B]);
    await owner.$executeRawUnsafe(`DELETE FROM clients WHERE tenant_id = ANY($1)`, [TENANT_A, TENANT_B]);
    await owner.$executeRawUnsafe(`DELETE FROM tenants WHERE id = ANY($1)`, [TENANT_A, TENANT_B]);
    await owner.$disconnect();
    await app.$disconnect();
  });

  // A tabela do job: sem contexto, ZERO. É a forma silenciosa de errar que o
  // §7.3 manda encarar — e a razão de o PR-2 abrir `runInTenantContext` no job.
  it.each(['artifacts', 'artifact_versions', 'artifact_runs', 'review_verdicts'])(
    'sem contexto de tenant, %s devolve zero linhas (fail-closed)',
    async (tabela) => {
      const rows = (await app.$queryRawUnsafe(`SELECT id FROM ${tabela}`)) as unknown[];
      expect(rows).toHaveLength(0);
    },
  );

  it('com contexto, o tenant só enxerga os próprios artefatos', async () => {
    const rows = await withTenant(app, [TENANT_A], (tx) =>
      tx.$queryRawUnsafe(`SELECT id FROM artifacts`),
    );
    expect(rows).toEqual([{ id: 'art-a' }]);
  });

  it('com contexto, o tenant só enxerga as próprias versões', async () => {
    const rows = await withTenant(app, [TENANT_A], (tx) =>
      tx.$queryRawUnsafe(`SELECT id FROM artifact_versions`),
    );
    expect(rows).toEqual([{ id: 'av-a' }]);
  });

  it('com contexto, o tenant só enxerga os próprios runs', async () => {
    const rows = await withTenant(app, [TENANT_A], (tx) =>
      tx.$queryRawUnsafe(`SELECT id FROM artifact_runs`),
    );
    expect(rows).toEqual([{ id: 'run-a' }]);
  });

  // A única das quatro que corta por JOIN. Se a policy dela estiver frouxa, o
  // parecer do revisor de outro tenant vaza junto da versão — e parecer carrega
  // texto do briefing.
  it('review_verdicts corta pelo tenant da versão (herança por JOIN)', async () => {
    const rows = await withTenant(app, [TENANT_A], (tx) =>
      tx.$queryRawUnsafe(`SELECT id FROM review_verdicts`),
    );
    expect(rows).toEqual([{ id: 'rv-a' }]);
  });

  it('pedir o artefato do outro tenant devolve vazio, não erro', async () => {
    // O critério de aceite (§5) é "mesma resposta de não-encontrado que um id
    // inexistente": o banco não pode distinguir os dois casos.
    const doOutro = await withTenant(app, [TENANT_A], (tx) =>
      tx.$queryRawUnsafe(`SELECT id FROM artifacts WHERE id = 'art-b'`),
    );
    const inexistente = await withTenant(app, [TENANT_A], (tx) =>
      tx.$queryRawUnsafe(`SELECT id FROM artifacts WHERE id = 'nao-existe'`),
    );
    expect(doOutro).toEqual([]);
    expect(doOutro).toEqual(inexistente);
  });
});

describe('SPEC-032: o índice parcial de idempotência (§7.4.2)', () => {
  let owner: PrismaClient;

  const T = '00000000-0000-4000-8000-a47ifac70003';

  beforeAll(async () => {
    applyMigrations();
    owner = ownerClient();

    await owner.$executeRawUnsafe(
      `INSERT INTO tenants (id, installation_id, account_login, account_type, created_at)
       VALUES ($1, NULL, 'art-idx', 'User', now()) ON CONFLICT (id) DO NOTHING`,
      T,
    );
    await owner.$executeRawUnsafe(
      `INSERT INTO clients (id, tenant_id, name, created_at, updated_at)
       VALUES ('cli-idx', $1, 'Cliente', now(), now()) ON CONFLICT (id) DO NOTHING`,
      T,
    );
    await owner.$executeRawUnsafe(
      `INSERT INTO client_projects (id, client_id, title, state, created_at, updated_at)
       VALUES ('cp-idx', 'cli-idx', 'Projeto', 'BRIEFING_SUBMITTED', now(), now()) ON CONFLICT (id) DO NOTHING`,
    );
    await owner.$executeRawUnsafe(
      `INSERT INTO artifacts (id, tenant_id, client_project_id, kind, state, created_at, updated_at)
       VALUES ('art-idx', $1, 'cp-idx', 'requirements', 'PENDING_REVIEW', now(), now()) ON CONFLICT (id) DO NOTHING`,
      T,
    );
    // A v1 da IA, com hash. É contra ela que as próximas inserções colidem.
    await owner.$executeRawUnsafe(
      `INSERT INTO artifact_versions (id, tenant_id, artifact_id, version, content, author, input_hash, created_at)
       VALUES ('av-idx-ai', $1, 'art-idx', 1, '{}'::jsonb, 'ai', 'hash-igual', now())`,
      T,
    );
  });

  afterAll(async () => {
    await owner.$executeRawUnsafe(`DELETE FROM artifact_versions WHERE tenant_id = $1`, T);
    await owner.$executeRawUnsafe(`DELETE FROM artifacts WHERE tenant_id = $1`, T);
    await owner.$executeRawUnsafe(`DELETE FROM clients WHERE tenant_id = $1`, T);
    await owner.$executeRawUnsafe(`DELETE FROM tenants WHERE id = $1`, T);
    await owner.$disconnect();
  });

  it('recusa a 2ª versão da IA com o mesmo inputHash (idempotência do gatilho)', async () => {
    // §2.8: o job rodando duas vezes para a mesma BriefingVersion não pode
    // produzir artefato duplicado.
    await expect(
      owner.$executeRawUnsafe(
        `INSERT INTO artifact_versions (id, tenant_id, artifact_id, version, content, author, input_hash, created_at)
         VALUES ('av-idx-dup', $1, 'art-idx', 2, '{}'::jsonb, 'ai', 'hash-igual', now())`,
        T,
      ),
    ).rejects.toThrow();
  });

  it('ACEITA duas versões humanas — é o `WHERE author = ai` que faz isso', async () => {
    // O caso que separa o índice parcial de um único comum. Sem o WHERE, a 2ª
    // edição humana teria de inventar um hash para não colidir — hash que não
    // hasheia nada. Com ele, as duas entram, ambas com input_hash NULL.
    await owner.$executeRawUnsafe(
      `INSERT INTO artifact_versions (id, tenant_id, artifact_id, version, content, author, parent_version_id, edited_by, created_at)
       VALUES ('av-idx-h1', $1, 'art-idx', 2, '{"t":"1a edicao"}'::jsonb, 'human', 'av-idx-ai', 'u1', now())`,
      T,
    );
    await owner.$executeRawUnsafe(
      `INSERT INTO artifact_versions (id, tenant_id, artifact_id, version, content, author, parent_version_id, edited_by, created_at)
       VALUES ('av-idx-h2', $1, 'art-idx', 3, '{"t":"2a edicao"}'::jsonb, 'human', 'av-idx-h1', 'u1', now())`,
      T,
    );

    const rows = (await owner.$queryRawUnsafe(
      `SELECT count(*)::int AS n FROM artifact_versions WHERE artifact_id = 'art-idx' AND author = 'human'`,
    )) as Array<{ n: number }>;
    expect(rows[0].n).toBe(2);
  });

  it('a versão da IA continua legível e inalterada após as edições', async () => {
    // §5: "a versão da IA continua legível e inalterada". A imutabilidade não é
    // só convenção do service — nada no caminho da edição a reescreve.
    const rows = (await owner.$queryRawUnsafe(
      `SELECT content, author FROM artifact_versions WHERE id = 'av-idx-ai'`,
    )) as Array<{ content: unknown; author: string }>;
    expect(rows[0]).toEqual({ content: {}, author: 'ai' });
  });
});
