/**
 * A enumeração de tenants das rodadas diárias, contra Postgres REAL
 * (SPEC-048 §A enumeração de tenants, ADR-030).
 *
 * **Este arquivo existe por causa de um defeito que passou por três fatias.** O
 * `tenantsConfigurados()` da SPEC-047 fazia `licSettings.findMany` **fora** de
 * `runInTenantContext` para responder *"quais tenants?"*. `proplan_app` é
 * `NOBYPASSRLS`, e a política das `lic_*` compara com `app.tenant_ids`: fora de
 * contexto, `current_setting(..., true)` é NULL, `x = ANY(NULL)` é NULL, e
 * **nenhuma linha passa — sem erro**. O sync diário rodava em produção, varria
 * zero tenants e reportava sucesso.
 *
 * **Por que nenhum teste pegou:** o unitário dobra o Prisma, e **mock não tem
 * RLS**. Ele afirmava o `where` da consulta e passava — provava a intenção, não
 * o efeito. Mesma classe do FIX #216.
 *
 * Então o que este arquivo prova só é provável aqui:
 *
 * 1. **A leitura direta realmente falha** — sem isto, os testes abaixo passariam
 *    mesmo que o RLS estivesse desligado, e não provariam nada.
 * 2. **A função enumera onde a leitura não enumera**, com a MESMA role e SEM
 *    contexto. É a diferença entre a rodada funcionar e reportar sucesso vazio.
 * 3. **Nenhum segredo sai pela função privilegiada.** `SECURITY DEFINER` roda com
 *    privilégio de owner: devolver `github_pat` ou `webhook_secret` daria a
 *    qualquer chamador o poder de convidar ao repo privado alheio ou forjar
 *    entrega assinada. É uma **ausência**, e ausência se prova consultando as
 *    colunas, não lendo o schema.
 * 4. **O RLS das tabelas continua de pé.** A função é o único caminho; se ela
 *    tivesse vindo acompanhada de um afrouxamento da policy, o isolamento teria
 *    sumido junto e nada acusaria.
 * 5. **Tenant com PAT e sem Kiwify é varrido pelo convite** — o caso exato que o
 *    filtro do catálogo pularia, e que a SPEC-048 nomeia como falha muda.
 */
import { PrismaClient } from '@prisma/client';
import { ownerClient, appClient, applyMigrations, grantAppRole } from '../../../test/int/db-harness';

/** Só PAT de source: entra no convite, fica fora do catálogo. */
const TENANT_PAT = '00000000-0000-4000-8000-e0031ea70001';
/** Só credenciais da Kiwify: entra no catálogo, fica fora do convite. */
const TENANT_KIWIFY = '00000000-0000-4000-8000-e0031ea70002';
/** Nenhuma credencial, mas tem licença com validade: só o sweep o enxerga. */
const TENANT_LICENCA = '00000000-0000-4000-8000-e0031ea70003';

const TODOS = [TENANT_PAT, TENANT_KIWIFY, TENANT_LICENCA];

describe('SPEC-048: enumeração de tenants sem contexto (ADR-030)', () => {
  let owner: PrismaClient;
  let app: PrismaClient;

  beforeAll(async () => {
    applyMigrations();
    owner = ownerClient();
    app = appClient();
    await grantAppRole(owner);
    await limpar();
    await semear();
  });

  afterAll(async () => {
    await limpar();
    await owner.$disconnect();
    await app.$disconnect();
  });

  /**
   * A âncora de todo o resto. Se este teste falhar, o RLS não está fazendo o que
   * se supõe — e os testes seguintes passariam por acidente.
   */
  it('a leitura DIRETA devolve zero linhas sem contexto — e sem erro', async () => {
    const settings = await app.$queryRawUnsafe<{ n: bigint }[]>(
      `SELECT count(*) AS n FROM lic_settings WHERE github_pat IS NOT NULL`,
    );
    const licencas = await app.$queryRawUnsafe<{ n: bigint }[]>(
      `SELECT count(*) AS n FROM licenses WHERE status = 'ACTIVE'`,
    );

    // **Zero, e nenhuma exceção.** É esta combinação que torna o defeito
    // invisível: um erro teria sido notado no primeiro deploy.
    expect(Number(settings[0].n)).toBe(0);
    expect(Number(licencas[0].n)).toBe(0);

    // E o dado existe de verdade — senão o zero acima não provaria nada.
    const doOwner = await owner.$queryRawUnsafe<{ n: bigint }[]>(
      `SELECT count(*) AS n FROM lic_settings WHERE tenant_id = ANY($1)`,
      TODOS,
    );
    expect(Number(doOwner[0].n)).toBe(3);
  });

  it('`lic_tenants_with_source_pat` enumera onde a leitura direta não enumera', async () => {
    const linhas = await app.$queryRawUnsafe<{ tenant_id: string }[]>(
      `SELECT tenant_id FROM lic_tenants_with_source_pat() WHERE tenant_id = ANY($1)`,
      TODOS,
    );

    // Mesma role, mesma ausência de contexto do teste anterior. A diferença é a
    // função — e é toda a diferença entre a rodada convidar alguém e reportar
    // sucesso tendo varrido ninguém.
    expect(linhas.map((l) => l.tenant_id)).toEqual([TENANT_PAT]);
  });

  it('tenant com PAT e SEM Kiwify é varrido pelo convite (o caso que o filtro do catálogo pularia)', async () => {
    const convite = await app.$queryRawUnsafe<{ tenant_id: string }[]>(
      `SELECT tenant_id FROM lic_tenants_with_source_pat() WHERE tenant_id = ANY($1)`,
      TODOS,
    );
    const catalogo = await app.$queryRawUnsafe<{ tenant_id: string }[]>(
      `SELECT tenant_id FROM lic_tenants_with_kiwify_credentials() WHERE tenant_id = ANY($1)`,
      TODOS,
    );

    // As duas listas são disjuntas neste seed, de propósito: herdar o filtro do
    // catálogo pularia o `TENANT_PAT`, e o convite dele nunca sairia — sem erro
    // em lugar nenhum. É a falha muda que a SPEC-048 nomeia.
    expect(convite.map((l) => l.tenant_id)).toEqual([TENANT_PAT]);
    expect(catalogo.map((l) => l.tenant_id)).toEqual([TENANT_KIWIFY]);
  });

  it('`lic_tenants_with_expiring_licenses` pega quem tem licença a expirar, sem exigir credencial', async () => {
    const linhas = await app.$queryRawUnsafe<{ tenant_id: string }[]>(
      `SELECT tenant_id FROM lic_tenants_with_expiring_licenses() WHERE tenant_id = ANY($1)`,
      TODOS,
    );

    // O sweep não fala com ninguém de fora: exigir credencial deixaria licença
    // vencida aparecendo como `ACTIVE` no admin de todo tenant sem Kiwify.
    // `TENANT_LICENCA` não tem credencial nenhuma e precisa ser varrido.
    expect(linhas.map((l) => l.tenant_id)).toEqual([TENANT_LICENCA]);
  });

  it('licença PERPETUAL (`expires_at` nulo) não põe o tenant na lista do sweep', async () => {
    const linhas = await app.$queryRawUnsafe<{ tenant_id: string }[]>(
      `SELECT tenant_id FROM lic_tenants_with_expiring_licenses() WHERE tenant_id = ANY($1)`,
      TODOS,
    );

    // `TENANT_PAT` tem licença perpétua. Incluí-lo gastaria uma volta de laço
    // por rodada para um `updateMany` que nunca afeta linha — e, se um dia o
    // filtro do `sweep` regredisse, seria o tenant onde o estrago apareceria.
    expect(linhas).not.toContainEqual({ tenant_id: TENANT_PAT });
  });

  /**
   * A regra 2 do ADR-030, verificada pelo catálogo do Postgres em vez de por
   * inspeção visual: o tipo de retorno declarado é o contrato.
   */
  it('as três funções devolvem SOMENTE `tenant_id` — nenhum segredo atravessa', async () => {
    const colunas = await owner.$queryRawUnsafe<{ proname: string; args: string }[]>(
      `SELECT p.proname, pg_get_function_result(p.oid) AS args
         FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public' AND p.proname LIKE 'lic_tenants_with_%'
        ORDER BY p.proname`,
    );

    expect(colunas).toHaveLength(3);
    for (const f of colunas) {
      // `TABLE(tenant_id text)` e nada mais. Uma coluna a mais aqui — um
      // `github_pat` acrescentado "para economizar uma consulta" — entregaria
      // `administration:write` no repo privado a quem chamasse a função.
      expect(f.args).toBe('TABLE(tenant_id text)');
    }
  });

  it('a função não é executável por PUBLIC', async () => {
    const acl = await owner.$queryRawUnsafe<{ proname: string; acl: string | null }[]>(
      `SELECT p.proname, array_to_string(p.proacl, ',') AS acl
         FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public' AND p.proname LIKE 'lic_tenants_with_%'`,
    );

    for (const f of acl) {
      // `proacl` não-nulo prova que o REVOKE rodou (nulo = default, que é
      // EXECUTE para PUBLIC). Sem ele, `SECURITY DEFINER` daria a enumeração a
      // qualquer role que um dia se conecte a este banco.
      expect(f.acl).toBeTruthy();
      expect(f.acl).not.toMatch(/(^|,)=X/);
      expect(f.acl).toMatch(/proplan_app=X/);
    }
  });

  it('o RLS das tabelas continua de pé — a função é o único caminho', async () => {
    // A correção não podia ser "afrouxar a policy": isso resolveria a
    // enumeração abrindo a tabela inteira, e o isolamento sumiria sem nada
    // acusar. Com contexto de UM tenant, a role vê só o dele.
    //
    // `set_config` com `is_local = true` dentro da transação, e o array no
    // formato literal do Postgres (`{id}`) — é assim que a aplicação o define.
    const doTenant = await app.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(
        `SELECT set_config('app.tenant_ids', $1, true)`,
        `{${TENANT_PAT}}`,
      );
      return tx.$queryRawUnsafe<{ tenant_id: string }[]>(
        `SELECT tenant_id FROM lic_settings ORDER BY tenant_id`,
      );
    });

    expect(doTenant.map((l) => l.tenant_id)).toEqual([TENANT_PAT]);
  });

  async function semear() {
    for (const [tenant, sufixo] of [
      [TENANT_PAT, 'pat'],
      [TENANT_KIWIFY, 'kwf'],
      [TENANT_LICENCA, 'lic'],
    ] as const) {
      await owner.$executeRawUnsafe(
        `INSERT INTO tenants (id, installation_id, account_login, account_type, created_at)
         VALUES ($1, NULL, $2, 'User', now()) ON CONFLICT (id) DO NOTHING`,
        tenant,
        `enum-${sufixo}`,
      );
      await owner.$executeRawUnsafe(
        `INSERT INTO lic_products (id, tenant_id, slug, name, key_prefix, created_at, updated_at)
         VALUES ($1, $2, 'warroom', 'War Room', 'WR', now(), now())
         ON CONFLICT (id) DO NOTHING`,
        `enumprod-${sufixo}`,
        tenant,
      );
      await owner.$executeRawUnsafe(
        `INSERT INTO lic_editions (id, product_id, slug, name, billing_model, max_machines,
                                   updates_months, grants_source_access, created_at, updated_at)
         VALUES ($1, $2, 'std', 'Padrão', 'PERPETUAL', 2, 12, false, now(), now())
         ON CONFLICT (id) DO NOTHING`,
        `enumedi-${sufixo}`,
        `enumprod-${sufixo}`,
      );
    }

    // Só PAT — nenhuma credencial da Kiwify.
    await owner.$executeRawUnsafe(
      `INSERT INTO lic_settings (id, tenant_id, webhook_secret, past_due_tolerance_days,
                                 github_pat, created_at, updated_at)
       VALUES ('enumset-pat', $1, 'seg-pat', 15, 'cifra-pat', now(), now())
       ON CONFLICT (tenant_id) DO NOTHING`,
      TENANT_PAT,
    );
    // Só Kiwify — nenhum PAT.
    await owner.$executeRawUnsafe(
      `INSERT INTO lic_settings (id, tenant_id, webhook_secret, past_due_tolerance_days,
                                 kiwify_client_id, kiwify_client_secret, kiwify_account_id,
                                 created_at, updated_at)
       VALUES ('enumset-kwf', $1, 'seg-kwf', 15, 'cid', 'csec', 'acct', now(), now())
       ON CONFLICT (tenant_id) DO NOTHING`,
      TENANT_KIWIFY,
    );
    // Sem credencial nenhuma — só a linha, para provar que o sweep não a exige.
    await owner.$executeRawUnsafe(
      `INSERT INTO lic_settings (id, tenant_id, webhook_secret, past_due_tolerance_days,
                                 created_at, updated_at)
       VALUES ('enumset-lic', $1, 'seg-lic', 15, now(), now())
       ON CONFLICT (tenant_id) DO NOTHING`,
      TENANT_LICENCA,
    );

    // Licença COM validade: é ela que põe o tenant na lista do sweep.
    await owner.$executeRawUnsafe(
      `INSERT INTO licenses (id, tenant_id, edition_id, key_hash, status, customer_email,
                             issued_at, updates_until, expires_at, created_at, updated_at)
       VALUES ('enumlic-lic', $1, 'enumedi-lic', $2, 'ACTIVE', 'c@exemplo.com',
               now(), now() + interval '365 days', now() + interval '30 days', now(), now())
       ON CONFLICT (id) DO NOTHING`,
      TENANT_LICENCA,
      'c'.repeat(64),
    );
    // Licença PERPETUAL (`expires_at` nulo): NÃO entra na lista do sweep.
    await owner.$executeRawUnsafe(
      `INSERT INTO licenses (id, tenant_id, edition_id, key_hash, status, customer_email,
                             issued_at, updates_until, expires_at, created_at, updated_at)
       VALUES ('enumlic-pat', $1, 'enumedi-pat', $2, 'ACTIVE', 'p@exemplo.com',
               now(), now() + interval '365 days', NULL, now(), now())
       ON CONFLICT (id) DO NOTHING`,
      TENANT_PAT,
      'd'.repeat(64),
    );
  }

  async function limpar() {
    await owner.$executeRawUnsafe(`DELETE FROM licenses WHERE tenant_id = ANY($1)`, TODOS);
    await owner.$executeRawUnsafe(`DELETE FROM lic_settings WHERE tenant_id = ANY($1)`, TODOS);
    await owner.$executeRawUnsafe(
      `DELETE FROM lic_editions WHERE product_id IN
         (SELECT id FROM lic_products WHERE tenant_id = ANY($1))`,
      TODOS,
    );
    await owner.$executeRawUnsafe(`DELETE FROM lic_products WHERE tenant_id = ANY($1)`, TODOS);
    await owner.$executeRawUnsafe(`DELETE FROM tenants WHERE id = ANY($1)`, TODOS);
  }
});
