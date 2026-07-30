/**
 * O schema da SPEC-039 (PR-1) contra Postgres REAL: isolamento do link e do PAT,
 * a função pública sem contexto, e as invariantes que o banco carrega.
 *
 * **Por que int-spec, e não teste de regra.** Nada aqui é lógica de aplicação —
 * é policy, índice, FK e `SECURITY DEFINER`. Um mock do Prisma "isola" o que o
 * teste mandou isolar e "resolve" o que o teste mandou resolver; as garantias
 * desta fatia só existem dentro do Postgres.
 *
 * Os cinco modos de errar que só aparecem assim:
 *
 * 1. **`resolve_source_link` ausente ou fail-closed.** `GET /s/:token` não tem
 *    sessão. Sem a função, o RLS devolve zero linhas para TODO token — inclusive
 *    os válidos — e o sintoma é "todo comprador vê link inválido", sem erro em
 *    log. É a 6ª vez que esta armadilha aparece na frente.
 * 2. **Dado pessoal saindo pela função privilegiada.** A página é pública: se a
 *    função devolvesse `customer_email`, o link vazado deixaria de ser só acesso
 *    indevido e passaria a ser vazamento de dado pessoal. É uma **ausência**, e
 *    ausência não se prova lendo o schema — se prova consultando as colunas.
 * 3. **RLS ausente na tabela nova.** `lic_source_links` guarda credencial de
 *    acesso a código-fonte. Esquecer o `ENABLE` não quebra nada visível: o
 *    tenant B simplesmente passaria a ler o token do tenant A.
 * 4. **O PAT de um tenant legível pelo outro.** É a decisão PI #2 — e o que ela
 *    protege é `administration:write` no repo privado de outra pessoa.
 * 5. **O booleano que sobreviveu.** `source_invited` **precisa** ter sumido: se
 *    a coluna continuar lá, algum caminho vai voltar a escrever nela e a
 *    revogação volta a não distinguir convite pendente de colaborador aceito.
 */
import { PrismaClient } from '@prisma/client';
import { ownerClient, appClient, applyMigrations, grantAppRole } from '../../../test/int/db-harness';

const TENANT = '00000000-0000-4000-8000-11fec1c10201';
const OUTRO_TENANT = '00000000-0000-4000-8000-11fec1c10202';

/** SHA-256 hex de 64 caracteres — o formato que a rota vai gravar. */
const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);

describe('SPEC-039: schema do convite ao repo source', () => {
  let owner: PrismaClient;
  let app: PrismaClient;

  beforeAll(async () => {
    applyMigrations();
    owner = ownerClient();
    app = appClient();
    await grantAppRole(owner);
    await semear();
  });

  afterAll(async () => {
    await limpar();
    await owner.$disconnect();
    await app.$disconnect();
  });

  beforeEach(async () => {
    // Resíduo do teste anterior colidiria com o unique do hash.
    await owner.$executeRawUnsafe(
      `DELETE FROM lic_source_links WHERE tenant_id = ANY($1)`,
      [TENANT, OUTRO_TENANT],
    );
  });

  // =========================================================================
  // Isolamento por tenant
  // =========================================================================

  describe('RLS em `lic_source_links`', () => {
    it('só devolve as linhas do contexto', async () => {
      await inserirLink(owner, TENANT, 'srclic-a', HASH_A);
      await inserirLink(owner, OUTRO_TENANT, 'srclic-b', HASH_B);

      const vistas = await comoTenant(TENANT, `SELECT tenant_id FROM lic_source_links`);

      // Não basta "vê a própria": um teste que só conta 1 passaria com uma
      // policy que devolvesse a linha errada.
      expect(vistas).toHaveLength(1);
      expect(vistas[0].tenant_id).toBe(TENANT);
    });

    it('é fail-closed: sem contexto, nenhuma linha', async () => {
      await inserirLink(owner, TENANT, 'srclic-a', HASH_A);

      // A pergunta não é "o RLS filtra?", é "o que acontece quando ninguém
      // disse quem eu sou?". Fail-OPEN aqui entregaria todo token de coleta a
      // qualquer caminho que esquecesse o contexto.
      const linhas = await app.$queryRawUnsafe(`SELECT tenant_id FROM lic_source_links`);
      expect(linhas).toEqual([]);
    });

    it('o PAT de um tenant não é legível pelo outro', async () => {
      // Decisão PI #2 em uma linha de teste. O que ela protege é
      // `administration:write` no repositório privado de outra pessoa.
      const vistas = await comoTenant<{ github_pat: string | null }>(
        OUTRO_TENANT,
        `SELECT github_pat FROM lic_settings`,
      );
      expect(vistas).toHaveLength(1);
      expect(vistas[0].github_pat).toBe('pat-b');
    });
  });

  // =========================================================================
  // resolve_source_link — o lookup público
  // =========================================================================

  describe('`resolve_source_link`: o lookup sem sessão', () => {
    it('resolve o token válido SEM contexto de tenant', async () => {
      await inserirLink(owner, TENANT, 'srclic-a', HASH_A);

      // É este o caminho da rota pública: `app` sem `set_config`. Se a função
      // não existisse, o resultado seria `[]` e todo comprador veria "link
      // inválido" — com a suíte de regras inteira verde.
      const linhas = await app.$queryRawUnsafe<
        { tenant_id: string; license_id: string; product_name: string; edition_name: string }[]
      >(`SELECT * FROM resolve_source_link('${HASH_A}')`);

      expect(linhas).toHaveLength(1);
      expect(linhas[0].tenant_id).toBe(TENANT);
      expect(linhas[0].license_id).toBe('srclic-a');
      // O que a página mostra vem daqui: sem isso ela precisaria de uma 2ª
      // consulta, que sem contexto de tenant devolveria vazio.
      expect(linhas[0].product_name).toBe('War Room');
      expect(linhas[0].edition_name).toBe('Com código-fonte');
    });

    it('token inexistente devolve vazio, não erro', async () => {
      // A rota traduz vazio em resposta não-diferencial. Se a função lançasse,
      // o `500` distinguiria inexistente de válido para quem sonda.
      const linhas = await app.$queryRawUnsafe(`SELECT * FROM resolve_source_link('${'f'.repeat(64)}')`);
      expect(linhas).toEqual([]);
    });

    it('devolve o `used_at` — quem decide "já utilizado" é a rota, não o SQL', async () => {
      await inserirLink(owner, TENANT, 'srclic-a', HASH_A, '2026-07-30T10:00:00Z');

      const linhas = await app.$queryRawUnsafe<{ used_at: Date | null }[]>(
        `SELECT * FROM resolve_source_link('${HASH_A}')`,
      );

      // A função NÃO filtra link usado. Se filtrasse, "usado" e "inexistente"
      // chegariam à rota como a mesma coisa — e o critério de aceite exige
      // "já utilizado", nunca o formulário de novo.
      expect(linhas).toHaveLength(1);
      expect(linhas[0].used_at).not.toBeNull();
    });

    it('NÃO devolve dado pessoal do comprador', async () => {
      await inserirLink(owner, TENANT, 'srclic-a', HASH_A);

      const linhas = await app.$queryRawUnsafe<Record<string, unknown>[]>(
        `SELECT * FROM resolve_source_link('${HASH_A}')`,
      );

      // Prova por ausência, do mesmo desenho das provas de ausência de receita
      // da SPEC-034/035. A página é PÚBLICA: quem tem a URL veria o e-mail do
      // comprador. Acrescentar a coluna aqui um dia seria uma linha inocente no
      // SQL e um vazamento na rota.
      const colunas = Object.keys(linhas[0]);
      expect(colunas).not.toContain('customer_email');
      expect(colunas).not.toContain('customer_name');
      expect(colunas).not.toContain('github_username');
      // E o segredo do tenant também não: a função é `SECURITY DEFINER` e
      // qualquer coluna que ela devolva ignora o RLS por definição.
      expect(colunas).not.toContain('github_pat');
      expect(colunas).not.toContain('webhook_secret');
      expect(colunas).not.toContain('token_hash');
    });

    it('não é chamável por PUBLIC', async () => {
      // `REVOKE ALL ... FROM PUBLIC` + `GRANT` explícito para `proplan_app`. Sem
      // o revoke, qualquer role do banco resolveria token de coleta.
      const [acl] = await owner.$queryRawUnsafe<{ has: boolean }[]>(
        `SELECT has_function_privilege('public', 'resolve_source_link(text)', 'EXECUTE') AS has`,
      );
      expect(acl.has).toBe(false);
    });
  });

  // =========================================================================
  // O booleano saiu, o estado entrou
  // =========================================================================

  describe('`source_invited` foi substituído pelo enum', () => {
    it('a coluna `source_invited` não existe mais', async () => {
      // Se ela sobreviver, algum caminho volta a escrever nela — e a revogação
      // volta a não distinguir convite pendente de colaborador aceito, que é o
      // no-op silencioso que esta fatia existe para fechar.
      const linhas = await owner.$queryRawUnsafe<{ column_name: string }[]>(
        `SELECT column_name FROM information_schema.columns
         WHERE table_name = 'licenses' AND column_name = 'source_invited'`,
      );
      expect(linhas).toEqual([]);
    });

    it('`source_access` nasce `NONE` e aceita os seis estados', async () => {
      const [linha] = await comoTenant<{ source_access: string }>(
        TENANT,
        `SELECT source_access FROM licenses WHERE id = 'srclic-a'`,
      );
      // Default explícito: licença que não dá source não pode nascer na fila do
      // job de convite.
      expect(linha.source_access).toBe('NONE');

      const [{ rotulos }] = await owner.$queryRawUnsafe<{ rotulos: string[] }[]>(
        `SELECT array_agg(e.enumlabel ORDER BY e.enumsortorder) AS rotulos
         FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
         WHERE t.typname = 'LicSourceAccess'`,
      );
      expect(rotulos).toEqual(['NONE', 'PENDING', 'INVITED', 'ACTIVE', 'REMOVED', 'FAILED']);
    });

    it('estado fora do enum é recusado pelo banco', async () => {
      // A garantia é do tipo, não de um `if`: um `sourceAccess: 'GRANTED'` vindo
      // de código novo falha aqui, não seis meses depois no admin.
      await expect(
        owner.$executeRawUnsafe(
          `UPDATE licenses SET source_access = 'GRANTED' WHERE id = 'srclic-a'`,
        ),
      ).rejects.toThrow();
    });
  });

  // =========================================================================
  // Invariantes do link
  // =========================================================================

  describe('o link de coleta', () => {
    it('recusa dois links com o mesmo hash', async () => {
      // `UNIQUE` no banco, não `findFirst` no código: duas requisições
      // simultâneas passariam as duas por um `if`.
      await inserirLink(owner, TENANT, 'srclic-a', HASH_A);
      await expect(inserirLink(owner, TENANT, 'srclic-a', HASH_A, null, 'outro-id')).rejects.toThrow();
    });

    it('some com a licença', async () => {
      // Cascade: o link é credencial de uso único, não prova de nada. Credencial
      // órfã apontando para licença apagada é só superfície.
      await inserirLink(owner, TENANT, 'srclic-a', HASH_A);
      await owner.$executeRawUnsafe(`DELETE FROM licenses WHERE id = 'srclic-a'`);

      const restantes = await owner.$queryRawUnsafe(
        `SELECT id FROM lic_source_links WHERE license_id = 'srclic-a'`,
      );
      expect(restantes).toEqual([]);

      await recriarLicenca();
    });
  });

  // =========================================================================
  // Fixtures
  // =========================================================================

  /** Roda a query sob o contexto de um tenant, como a aplicação faz. */
  async function comoTenant<T = { tenant_id: string }>(
    tenantId: string,
    sql: string,
  ): Promise<T[]> {
    return app.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SELECT set_config('app.tenant_ids', $1, true)`, `{${tenantId}}`);
      return tx.$queryRawUnsafe(sql) as Promise<T[]>;
    });
  }

  async function semear() {
    for (const [tenant, sufixo, pat] of [
      [TENANT, 'a', 'pat-a'],
      [OUTRO_TENANT, 'b', 'pat-b'],
    ] as const) {
      await owner.$executeRawUnsafe(
        `INSERT INTO tenants (id, installation_id, account_login, account_type, created_at)
         VALUES ($1, NULL, $2, 'User', now()) ON CONFLICT (id) DO NOTHING`,
        tenant,
        `src-${sufixo}`,
      );
      await owner.$executeRawUnsafe(
        `INSERT INTO lic_products (id, tenant_id, slug, name, key_prefix, source_repo,
                                   created_at, updated_at)
         VALUES ($1, $2, 'warroom', 'War Room', 'WR', $3, now(), now())
         ON CONFLICT (id) DO NOTHING`,
        `srcprod-${sufixo}`,
        tenant,
        `RodReis/war-room-${sufixo}`,
      );
      await owner.$executeRawUnsafe(
        `INSERT INTO lic_editions (id, product_id, slug, name, billing_model, max_machines,
                                   updates_months, grants_source_access, created_at, updated_at)
         VALUES ($1, $2, 'source', 'Com código-fonte', 'PERPETUAL', 2, 12, true, now(), now())
         ON CONFLICT (id) DO NOTHING`,
        `srcedi-${sufixo}`,
        `srcprod-${sufixo}`,
      );
      await owner.$executeRawUnsafe(
        `INSERT INTO lic_settings (id, tenant_id, webhook_secret, past_due_tolerance_days,
                                   github_pat, created_at, updated_at)
         VALUES ($1, $2, $3, 15, $4, now(), now()) ON CONFLICT (tenant_id) DO NOTHING`,
        `srcset-${sufixo}`,
        tenant,
        `segredo-${sufixo}`,
        pat,
      );
    }
    await recriarLicenca();
  }

  async function recriarLicenca() {
    for (const [id, tenant, sufixo] of [
      ['srclic-a', TENANT, 'a'],
      ['srclic-b', OUTRO_TENANT, 'b'],
    ] as const) {
      await owner.$executeRawUnsafe(
        `INSERT INTO licenses (id, tenant_id, edition_id, key_hash, status, customer_email,
                               issued_at, updates_until, created_at, updated_at)
         VALUES ($1, $2, $3, $4, 'ACTIVE', 'comprador@exemplo.com',
                 now(), now() + interval '12 months', now(), now())
         ON CONFLICT (id) DO NOTHING`,
        id,
        tenant,
        `srcedi-${sufixo}`,
        `hash-src-${sufixo}`,
      );
    }
  }

  async function limpar() {
    const ids = [TENANT, OUTRO_TENANT];
    for (const tabela of [
      'lic_source_links',
      'lic_settings',
      'licenses',
      'lic_products',
    ]) {
      await owner.$executeRawUnsafe(`DELETE FROM ${tabela} WHERE tenant_id = ANY($1)`, ids);
    }
    await owner.$executeRawUnsafe(`DELETE FROM tenants WHERE id = ANY($1)`, ids);
  }
});

/** Inserção pelo OWNER: exercita FK e UNIQUE, não o Prisma. */
function inserirLink(
  db: PrismaClient,
  tenantId: string,
  licenseId: string,
  tokenHash: string,
  usedAt: string | null = null,
  id = `srclink-${tokenHash.slice(0, 4)}`,
) {
  return db.$executeRawUnsafe(
    `INSERT INTO lic_source_links (id, tenant_id, license_id, token_hash, used_at, created_at)
     VALUES ($1, $2, $3, $4, $5::timestamp, now())`,
    id,
    tenantId,
    licenseId,
    tokenHash,
    usedAt,
  );
}
