/**
 * `licensing` contra Postgres REAL: isolamento e as barreiras que só o banco
 * garante (SPEC-036, ADR-020).
 *
 * Por que int-spec e não mock, aqui especificamente: esta tabela decide **quem
 * pode rodar um produto pago**. Os modos de errar abaixo são silenciosos —
 * nenhum levanta exceção no caminho feliz, e todos produzem uma resposta
 * plausível:
 *
 * 1. **Fail-closed sem contexto.** Ler ou gravar sem `runInTenantContext` não
 *    dá erro, dá ZERO LINHAS. Uma emissão que gravou zero tem a mesma cara de
 *    uma bem-sucedida vista de fora, e o comprador fica sem a chave.
 * 2. **A segunda máquina virando a terceira.** A idempotência do `/activate` é
 *    o unique `(license_id, fingerprint)`. Sem ele, duas requisições
 *    simultâneas da MESMA máquina passariam as duas por um `if` no código e
 *    consumiriam as duas vagas — o comprador perderia a segunda sem ter
 *    ativado nada além do primeiro computador.
 * 3. **Revogada que continua ativando.** `status = REVOKED` sem `revoked_at`
 *    (ou o inverso) é uma licença que diz duas coisas ao mesmo tempo. O
 *    segundo caso é o que produz ativação indevida depois de um reembolso.
 * 4. **`resolve_license` vazando o comprador.** A função roda com privilégio de
 *    owner numa rota SEM SESSÃO. Se ela devolvesse nome ou e-mail, quem
 *    adivinhasse uma chave leria dado pessoal — e o RLS não estaria mais no
 *    caminho para impedir.
 */
import { PrismaClient } from '@prisma/client';
import { ownerClient, appClient, applyMigrations, grantAppRole } from '../../test/int/db-harness';

const TENANT_A = '00000000-0000-4000-8000-11c0057a0001';
const TENANT_B = '00000000-0000-4000-8000-11c0057a0002';

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

describe('SPEC-036: isolamento de `licensing`', () => {
  let owner: PrismaClient;
  let app: PrismaClient;

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
        `lic-${sufixo}`,
      );
      await owner.$executeRawUnsafe(
        `INSERT INTO lic_products (id, tenant_id, slug, name, key_prefix, created_at, updated_at)
         VALUES ($1, $2, 'warroom', 'War Room', 'WR', now(), now())
         ON CONFLICT (id) DO NOTHING`,
        `lprod-${sufixo}`,
        tenant,
      );
      await owner.$executeRawUnsafe(
        `INSERT INTO lic_editions (id, product_id, slug, name, billing_model,
                                   max_machines, updates_months, created_at, updated_at)
         VALUES ($1, $2, 'closed', 'Sem código-fonte', 'PERPETUAL', 2, 12, now(), now())
         ON CONFLICT (id) DO NOTHING`,
        `ledi-${sufixo}`,
        `lprod-${sufixo}`,
      );
      await owner.$executeRawUnsafe(
        `INSERT INTO licenses (id, tenant_id, edition_id, key_hash, status,
                               customer_email, customer_name, issued_at,
                               updates_until, created_at, updated_at)
         VALUES ($1, $2, $3, $4, 'ACTIVE', $5, 'Comprador', now(),
                 now() + interval '12 months', now(), now())
         ON CONFLICT (id) DO NOTHING`,
        `llic-${sufixo}`,
        tenant,
        `ledi-${sufixo}`,
        `hash-${sufixo}`,
        `comprador-${sufixo}@exemplo.com`,
      );
      await owner.$executeRawUnsafe(
        `INSERT INTO lic_activations (id, tenant_id, license_id, fingerprint,
                                      hostname, activated_at, last_seen_at)
         VALUES ($1, $2, $3, $4, 'maquina-1', now(), now())
         ON CONFLICT (id) DO NOTHING`,
        `lact-${sufixo}`,
        tenant,
        `llic-${sufixo}`,
        `fp-${sufixo}-1`,
      );
      await owner.$executeRawUnsafe(
        `INSERT INTO lic_events (id, tenant_id, license_id, type, created_at)
         VALUES ($1, $2, $3, 'issued', now()) ON CONFLICT (id) DO NOTHING`,
        `levt-${sufixo}`,
        tenant,
        `llic-${sufixo}`,
      );
    }
  });

  afterAll(async () => {
    const ids = [TENANT_A, TENANT_B];
    await owner.$executeRawUnsafe(`DELETE FROM lic_events WHERE tenant_id = ANY($1)`, ids);
    await owner.$executeRawUnsafe(`DELETE FROM lic_activations WHERE tenant_id = ANY($1)`, ids);
    await owner.$executeRawUnsafe(`DELETE FROM licenses WHERE tenant_id = ANY($1)`, ids);
    await owner.$executeRawUnsafe(`DELETE FROM lic_products WHERE tenant_id = ANY($1)`, ids);
    await owner.$executeRawUnsafe(`DELETE FROM tenants WHERE id = ANY($1)`, ids);
    await owner.$disconnect();
    await app.$disconnect();
  });

  // As cinco tabelas, incluindo a `lic_editions`, que não tem `tenant_id` e
  // corta por JOIN no produto dono — o modo mais fácil de escrever uma policy
  // que não protege nada.
  it.each([
    ['lic_products'],
    ['lic_editions'],
    ['licenses'],
    ['lic_activations'],
    ['lic_events'],
  ])('sem contexto de tenant, %s devolve zero linhas (fail-closed)', async (tabela) => {
    const rows = (await app.$queryRawUnsafe(`SELECT id FROM ${tabela}`)) as unknown[];
    expect(rows).toHaveLength(0);
  });

  it('com contexto, o tenant só enxerga as próprias licenças', async () => {
    const rows = await withTenant(app, [TENANT_A], (tx) =>
      tx.$queryRawUnsafe(`SELECT id FROM licenses`),
    );
    expect(rows).toEqual([{ id: 'llic-a' }]);
  });

  it('a edição do outro tenant não aparece, mesmo sem tenant_id próprio', async () => {
    // `lic_editions` corta por JOIN. Se a policy tivesse sido escrita sem o
    // EXISTS, esta seria a linha que vazaria — e com ela `max_machines`, que é
    // o limite comercial do concorrente.
    const rows = await withTenant(app, [TENANT_A], (tx) =>
      tx.$queryRawUnsafe(`SELECT id FROM lic_editions`),
    );
    expect(rows).toEqual([{ id: 'ledi-a' }]);
  });

  it('pedir a licença do outro tenant devolve vazio, não erro', async () => {
    // A resposta tem de ser indistinguível de um id inexistente. Distinguir os
    // dois casos já é vazamento — confirma que aquele id existe em algum lugar.
    const doOutro = await withTenant(app, [TENANT_A], (tx) =>
      tx.$queryRawUnsafe(`SELECT id FROM licenses WHERE id = 'llic-b'`),
    );
    const inexistente = await withTenant(app, [TENANT_A], (tx) =>
      tx.$queryRawUnsafe(`SELECT id FROM licenses WHERE id = 'nao-existe'`),
    );
    expect(doOutro).toEqual([]);
    expect(doOutro).toEqual(inexistente);
  });

  it('recusa a segunda ativação da MESMA máquina na mesma licença', async () => {
    // O unique é o que transforma "reativar é idempotente" em garantia do
    // banco: sem ele, duas requisições simultâneas do mesmo computador
    // consumiriam as duas vagas do comprador.
    await expect(
      owner.$executeRawUnsafe(
        `INSERT INTO lic_activations (id, tenant_id, license_id, fingerprint,
                                      activated_at, last_seen_at)
         VALUES ('lact-dup', $1, 'llic-a', 'fp-a-1', now(), now())`,
        TENANT_A,
      ),
    ).rejects.toThrow();
  });

  it('recusa duas chaves com o mesmo hash', async () => {
    // `key_hash` é o único caminho de busca do `/activate`. Dois hashes iguais
    // fariam o lookup devolver "uma das duas" — e nada diria qual licença o
    // license file assinado estaria descrevendo.
    await expect(
      owner.$executeRawUnsafe(
        `INSERT INTO licenses (id, tenant_id, edition_id, key_hash, status,
                               customer_email, issued_at, updates_until,
                               created_at, updated_at)
         VALUES ('llic-dup', $1, 'ledi-a', 'hash-a', 'ACTIVE', 'x@exemplo.com',
                 now(), now() + interval '12 months', now(), now())`,
        TENANT_A,
      ),
    ).rejects.toThrow();
  });

  it('recusa REVOKED sem data e ACTIVE com data de revogação', async () => {
    // O segundo caso é o que produz ativação indevida: a licença foi revogada
    // por reembolso, mas o `status` continua dizendo ACTIVE e o `/activate`
    // devolveria 200 em vez de 410.
    await expect(
      owner.$executeRawUnsafe(
        `UPDATE licenses SET status = 'REVOKED' WHERE id = 'llic-a'`,
      ),
    ).rejects.toThrow();

    await expect(
      owner.$executeRawUnsafe(
        `UPDATE licenses SET revoked_at = now() WHERE id = 'llic-a'`,
      ),
    ).rejects.toThrow();
  });

  it('resolve_license acha a licença sem contexto de tenant e devolve o dono', async () => {
    // É a razão de a função existir: `/activate` não tem sessão, então roda sem
    // `app.tenant_ids`, e o RLS fail-closed devolveria vazio para TODA chave —
    // inclusive as válidas.
    const rows = (await app.$queryRawUnsafe(
      `SELECT * FROM resolve_license('hash-a')`,
    )) as Array<Record<string, unknown>>;

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: 'llic-a',
      tenant_id: TENANT_A,
      status: 'ACTIVE',
      max_machines: 2,
      edition_slug: 'closed',
      billing_model: 'PERPETUAL',
    });
  });

  it('resolve_license NÃO devolve nada do comprador', async () => {
    // A função roda com privilégio de owner numa rota sem sessão. Se ela
    // devolvesse nome ou e-mail, quem adivinhasse uma chave leria dado pessoal
    // — e o RLS não estaria mais no caminho para impedir. A ausência é a
    // proteção, então ela precisa ser afirmada.
    const rows = (await app.$queryRawUnsafe(
      `SELECT * FROM resolve_license('hash-a')`,
    )) as Array<Record<string, unknown>>;

    const colunas = Object.keys(rows[0]);
    expect(colunas).not.toContain('customer_email');
    expect(colunas).not.toContain('customer_name');
    expect(JSON.stringify(rows[0])).not.toContain('comprador-a@exemplo.com');
  });

  it('resolve_license devolve vazio para chave inexistente (o 404 do /activate)', async () => {
    const rows = (await app.$queryRawUnsafe(
      `SELECT * FROM resolve_license('hash-que-nao-existe')`,
    )) as unknown[];
    expect(rows).toHaveLength(0);
  });

  it('apagar a edição é recusado enquanto houver licença vendida nela', async () => {
    // Restrict e não Cascade: apagar a edição levaria junto as licenças
    // vendidas nela, e com elas a resposta a "o que este cliente comprou?".
    await expect(
      owner.$executeRawUnsafe(`DELETE FROM lic_editions WHERE id = 'ledi-a'`),
    ).rejects.toThrow();
  });

  it('desconectar o repo do catálogo não apaga o produto licenciado', async () => {
    // SetNull e não Cascade (MVP4 §4): junto com o produto iriam as licenças já
    // vendidas dele. O vínculo com o repo é enriquecimento, não a raiz.
    await owner.$executeRawUnsafe(
      `INSERT INTO users (id, github_id, login, created_at, updated_at)
       VALUES ('luser-a', 987001, 'lic-user-a', now(), now()) ON CONFLICT (id) DO NOTHING`,
    );
    await owner.$executeRawUnsafe(
      `INSERT INTO projects (id, user_id, tenant_id, github_repo_id, owner, name,
                             default_branch, is_private, created_at)
       VALUES ('lproj-a', 'luser-a', $1, 987002, 'rr', 'war-room', 'main', true, now())
       ON CONFLICT (id) DO NOTHING`,
      TENANT_A,
    );
    await owner.$executeRawUnsafe(
      `UPDATE lic_products SET project_id = 'lproj-a' WHERE id = 'lprod-a'`,
    );

    await owner.$executeRawUnsafe(`DELETE FROM projects WHERE id = 'lproj-a'`);

    const rows = (await owner.$queryRawUnsafe(
      `SELECT project_id FROM lic_products WHERE id = 'lprod-a'`,
    )) as Array<{ project_id: string | null }>;
    expect(rows).toEqual([{ project_id: null }]);

    await owner.$executeRawUnsafe(`DELETE FROM users WHERE id = 'luser-a'`);
  });
});
