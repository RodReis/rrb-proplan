/**
 * `estimates` contra Postgres REAL: isolamento e as barreiras que só o banco
 * garante (SPEC-033 §5, ADR-020).
 *
 * Por que int-spec e não mock, aqui especificamente: esta tabela guarda
 * **dinheiro**. Os quatro modos de errar abaixo são silenciosos — nenhum
 * levanta exceção no caminho feliz, e todos produzem um número plausível:
 *
 * 1. **Fail-closed sem contexto.** Mesma armadilha da SPEC-032: ler ou gravar
 *    sem `runInTenantContext` não dá erro, dá ZERO LINHAS. Uma estimativa
 *    "gerada" que gravou zero tem a mesma cara de uma bem-sucedida vista de
 *    fora. 5 ocorrências desta classe nesta frente.
 * 2. **Aprovação sem ator.** O §2.11 exige ator nunca nulo porque este é o ato
 *    que move o card para `CONTRACT_PENDING`. Uma linha `approved_at` sem
 *    `approved_by` seria uma estimativa aprovada por ninguém.
 * 3. **Contingência fora de faixa.** `150` no lugar de `15` multiplica o
 *    orçamento por 2,5 e nada falha — o total sai maior e parece deliberado.
 * 4. **Câmbio sem data.** Taxa sem data é número sem validade: meses depois
 *    ninguém sabe se a cotação era de ontem, e o total em BRL segue exibido
 *    como se fosse corrente.
 */
import { PrismaClient } from '@prisma/client';
import { ownerClient, appClient, applyMigrations, grantAppRole } from '../../test/int/db-harness';

const TENANT_A = '00000000-0000-4000-8000-e57ima7e0001';
const TENANT_B = '00000000-0000-4000-8000-e57ima7e0002';

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

/** Colunas obrigatórias de uma estimativa, com valores que satisfazem os CHECKs. */
const CENARIOS = `'{"otimista":{"horas":10,"totalBrl":2000}}'::jsonb`;

describe('SPEC-033: isolamento de `estimates`', () => {
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
        `est-${sufixo}`,
      );
      await owner.$executeRawUnsafe(
        `INSERT INTO clients (id, tenant_id, name, created_at, updated_at)
         VALUES ($1, $2, 'Cliente', now(), now()) ON CONFLICT (id) DO NOTHING`,
        `ecli-${sufixo}`,
        tenant,
      );
      await owner.$executeRawUnsafe(
        `INSERT INTO client_projects (id, client_id, title, state, created_at, updated_at)
         VALUES ($1, $2, 'Projeto', 'ARTIFACTS_READY', now(), now()) ON CONFLICT (id) DO NOTHING`,
        `ecp-${sufixo}`,
        `ecli-${sufixo}`,
      );
      // O `effort_breakdown` aprovado é o insumo real do cálculo — sem ele a FK
      // não fecha e o teste provaria menos do que diz.
      await owner.$executeRawUnsafe(
        `INSERT INTO artifacts (id, tenant_id, client_project_id, kind, state, created_at, updated_at)
         VALUES ($1, $2, $3, 'effort_breakdown', 'APPROVED', now(), now()) ON CONFLICT (id) DO NOTHING`,
        `eart-${sufixo}`,
        tenant,
        `ecp-${sufixo}`,
      );
      await owner.$executeRawUnsafe(
        `INSERT INTO artifact_versions (id, tenant_id, artifact_id, version, content, author, input_hash, created_at)
         VALUES ($1, $2, $3, 1, '{"tarefas":[]}'::jsonb, 'ai', $4, now()) ON CONFLICT (id) DO NOTHING`,
        `eav-${sufixo}`,
        tenant,
        `eart-${sufixo}`,
        `eih-${sufixo}`,
      );
      await owner.$executeRawUnsafe(
        `INSERT INTO estimates (
           id, tenant_id, client_project_id, version, effort_version_id,
           hourly_rate_brl, contingency_percent, complexity, complexity_factor,
           direct_costs, ai_cost_incurred_usd, ai_cost_projected,
           scenarios, mvp_breakdown, created_at
         ) VALUES ($1, $2, $3, 1, $4, 200, 15, 'media', 1.0000,
                   '[]'::jsonb, 0.045, '{"valueUsd":0.05,"isCalculated":false}'::jsonb,
                   ${CENARIOS}, '[]'::jsonb, now())
         ON CONFLICT (id) DO NOTHING`,
        `est-${sufixo}`,
        tenant,
        `ecp-${sufixo}`,
        `eav-${sufixo}`,
      );
    }
  });

  afterAll(async () => {
    await owner.$executeRawUnsafe(`DELETE FROM estimates WHERE tenant_id = ANY($1)`, [TENANT_A, TENANT_B]);
    await owner.$executeRawUnsafe(`DELETE FROM artifact_versions WHERE tenant_id = ANY($1)`, [TENANT_A, TENANT_B]);
    await owner.$executeRawUnsafe(`DELETE FROM artifacts WHERE tenant_id = ANY($1)`, [TENANT_A, TENANT_B]);
    await owner.$executeRawUnsafe(`DELETE FROM clients WHERE tenant_id = ANY($1)`, [TENANT_A, TENANT_B]);
    await owner.$executeRawUnsafe(`DELETE FROM tenants WHERE id = ANY($1)`, [TENANT_A, TENANT_B]);
    await owner.$disconnect();
    await app.$disconnect();
  });

  it('sem contexto de tenant, estimates devolve zero linhas (fail-closed)', async () => {
    const rows = (await app.$queryRawUnsafe(`SELECT id FROM estimates`)) as unknown[];
    expect(rows).toHaveLength(0);
  });

  it('com contexto, o tenant só enxerga as próprias estimativas', async () => {
    const rows = await withTenant(app, [TENANT_A], (tx) =>
      tx.$queryRawUnsafe(`SELECT id FROM estimates`),
    );
    expect(rows).toEqual([{ id: 'est-a' }]);
  });

  it('pedir a estimativa do outro tenant devolve vazio, não erro', async () => {
    // §5: a resposta tem de ser indistinguível de um id inexistente. Distinguir
    // os dois casos já é vazamento — confirma que aquele id existe em algum
    // lugar, e o id de uma estimativa aparece em URL.
    const doOutro = await withTenant(app, [TENANT_A], (tx) =>
      tx.$queryRawUnsafe(`SELECT id FROM estimates WHERE id = 'est-b'`),
    );
    const inexistente = await withTenant(app, [TENANT_A], (tx) =>
      tx.$queryRawUnsafe(`SELECT id FROM estimates WHERE id = 'nao-existe'`),
    );
    expect(doOutro).toEqual([]);
    expect(doOutro).toEqual(inexistente);
  });

  it('reestimar cria linha nova; a v1 permanece inalterada (§2.10)', async () => {
    await owner.$executeRawUnsafe(
      `INSERT INTO estimates (
         id, tenant_id, client_project_id, version, effort_version_id,
         hourly_rate_brl, contingency_percent, complexity, complexity_factor,
         direct_costs, ai_cost_incurred_usd, ai_cost_projected,
         scenarios, mvp_breakdown, created_at
       ) VALUES ('est-a-v2', $1, 'ecp-a', 2, 'eav-a', 250, 20, 'alta', 1.3000,
                 '[]'::jsonb, 0.09, '{"valueUsd":0.1,"isCalculated":true}'::jsonb,
                 ${CENARIOS}, '[]'::jsonb, now())`,
      TENANT_A,
    );

    const rows = (await owner.$queryRawUnsafe(
      `SELECT version, hourly_rate_brl::text AS taxa FROM estimates
       WHERE client_project_id = 'ecp-a' ORDER BY version`,
    )) as Array<{ version: number; taxa: string }>;

    // A v1 continua com os parâmetros do instante em que foi calculada. É o
    // snapshot que torna o número reproduzível: se ela lesse `tenant_settings`
    // por relação, mudar o valor/hora reescreveria uma proposta já enviada.
    expect(rows).toEqual([
      { version: 1, taxa: '200.00' },
      { version: 2, taxa: '250.00' },
    ]);

    await owner.$executeRawUnsafe(`DELETE FROM estimates WHERE id = 'est-a-v2'`);
  });

  it('recusa duas estimativas com a mesma versão no mesmo projeto', async () => {
    // O unique é o que transforma "reestimar cria linha nova" em garantia do
    // banco: duas gerações simultâneas colidem aqui em vez de gravarem duas v3.
    await expect(
      owner.$executeRawUnsafe(
        `INSERT INTO estimates (
           id, tenant_id, client_project_id, version, effort_version_id,
           hourly_rate_brl, contingency_percent, complexity, complexity_factor,
           direct_costs, ai_cost_incurred_usd, ai_cost_projected,
           scenarios, mvp_breakdown, created_at
         ) VALUES ('est-a-dup', $1, 'ecp-a', 1, 'eav-a', 200, 15, 'media', 1.0000,
                   '[]'::jsonb, 0, '{"valueUsd":0,"isCalculated":false}'::jsonb,
                   ${CENARIOS}, '[]'::jsonb, now())`,
        TENANT_A,
      ),
    ).rejects.toThrow();
  });

  it('recusa apagar a versão do effort_breakdown que originou a estimativa', async () => {
    // FK `RESTRICT`, não `CASCADE` nem `SET NULL`: a decomposição é a CONTA que
    // explica o número. Com CASCADE, apagá-la levaria junto a estimativa já
    // enviada ao cliente; com SET NULL, deixaria o número órfão da conta —
    // "reproduzível" deixaria de ser verdade sem que nada falhasse.
    await expect(
      owner.$executeRawUnsafe(`DELETE FROM artifact_versions WHERE id = 'eav-a'`),
    ).rejects.toThrow();
  });
});

describe('SPEC-033: as barreiras de dinheiro no banco', () => {
  let owner: PrismaClient;

  const T = '00000000-0000-4000-8000-e57ima7e0003';

  // Versão distinta a cada inserção: o unique `(client_project_id, version)` é
  // real, e reaproveitar o número faria os testes de CHECK falharem pelo motivo
  // errado — passariam a provar o unique em vez da barreira que dizem provar.
  let proximaVersao = 1;

  /** Insere uma estimativa completando o mínimo; `cols` sobrescreve colunas. */
  async function inserir(id: string, cols: Record<string, string>): Promise<void> {
    const base: Record<string, string> = {
      hourly_rate_brl: '200',
      contingency_percent: '15',
      complexity: `'media'`,
      complexity_factor: '1.0000',
      direct_costs: `'[]'::jsonb`,
      ai_cost_incurred_usd: '0',
      ai_cost_projected: `'{"valueUsd":0,"isCalculated":false}'::jsonb`,
      scenarios: CENARIOS,
      mvp_breakdown: `'[]'::jsonb`,
      approved_at: 'NULL',
      approved_by: 'NULL',
      exchange_rate: 'NULL',
      exchange_rate_at: 'NULL',
      ...cols,
    };
    const nomes = Object.keys(base).join(', ');
    const valores = Object.values(base).join(', ');
    await owner.$executeRawUnsafe(
      `INSERT INTO estimates (id, tenant_id, client_project_id, version, effort_version_id, ${nomes}, created_at)
       VALUES ('${id}', '${T}', 'ecp-chk', ${proximaVersao++}, 'eav-chk', ${valores}, now())`,
    );
  }

  beforeAll(async () => {
    applyMigrations();
    owner = ownerClient();

    await owner.$executeRawUnsafe(
      `INSERT INTO tenants (id, installation_id, account_login, account_type, created_at)
       VALUES ($1, NULL, 'est-chk', 'User', now()) ON CONFLICT (id) DO NOTHING`,
      T,
    );
    await owner.$executeRawUnsafe(
      `INSERT INTO clients (id, tenant_id, name, created_at, updated_at)
       VALUES ('ecli-chk', $1, 'Cliente', now(), now()) ON CONFLICT (id) DO NOTHING`,
      T,
    );
    await owner.$executeRawUnsafe(
      `INSERT INTO client_projects (id, client_id, title, state, created_at, updated_at)
       VALUES ('ecp-chk', 'ecli-chk', 'Projeto', 'ARTIFACTS_READY', now(), now()) ON CONFLICT (id) DO NOTHING`,
    );
    await owner.$executeRawUnsafe(
      `INSERT INTO artifacts (id, tenant_id, client_project_id, kind, state, created_at, updated_at)
       VALUES ('eart-chk', $1, 'ecp-chk', 'effort_breakdown', 'APPROVED', now(), now()) ON CONFLICT (id) DO NOTHING`,
      T,
    );
    await owner.$executeRawUnsafe(
      `INSERT INTO artifact_versions (id, tenant_id, artifact_id, version, content, author, input_hash, created_at)
       VALUES ('eav-chk', $1, 'eart-chk', 1, '{"tarefas":[]}'::jsonb, 'ai', 'ih-chk', now()) ON CONFLICT (id) DO NOTHING`,
      T,
    );
  });

  afterAll(async () => {
    await owner.$executeRawUnsafe(`DELETE FROM estimates WHERE tenant_id = $1`, T);
    await owner.$executeRawUnsafe(`DELETE FROM artifact_versions WHERE tenant_id = $1`, T);
    await owner.$executeRawUnsafe(`DELETE FROM artifacts WHERE tenant_id = $1`, T);
    await owner.$executeRawUnsafe(`DELETE FROM clients WHERE tenant_id = $1`, T);
    await owner.$executeRawUnsafe(`DELETE FROM tenants WHERE id = $1`, T);
    await owner.$disconnect();
  });

  it('recusa aprovação sem ator (§2.11: ator nunca nulo)', async () => {
    // Este é o ato que move o card para `CONTRACT_PENDING`. Sem ator, o funil
    // avança e a trilha não sabe dizer por decisão de quem.
    await expect(inserir('e1', { approved_at: 'now()' })).rejects.toThrow();
  });

  it('recusa ator sem data de aprovação', async () => {
    await expect(inserir('e2', { approved_by: `'u1'` })).rejects.toThrow();
  });

  it('aceita o par completo de aprovação', async () => {
    await inserir('e3', { approved_at: 'now()', approved_by: `'u1'` });
    const rows = (await owner.$queryRawUnsafe(
      `SELECT approved_by FROM estimates WHERE id = 'e3'`,
    )) as Array<{ approved_by: string }>;
    expect(rows[0].approved_by).toBe('u1');
  });

  it('recusa contingência acima de 100%', async () => {
    // `150` no lugar de `15` multiplicaria o orçamento por 2,5 sem que nada
    // falhasse — o total sairia maior e pareceria deliberado.
    await expect(inserir('e4', { contingency_percent: '150' })).rejects.toThrow();
  });

  it('recusa contingência negativa', async () => {
    await expect(inserir('e5', { contingency_percent: '-1' })).rejects.toThrow();
  });

  it('recusa câmbio sem data (taxa sem validade)', async () => {
    await expect(inserir('e6', { exchange_rate: '5.42' })).rejects.toThrow();
  });

  it('recusa data de câmbio sem taxa', async () => {
    await expect(inserir('e7', { exchange_rate_at: 'now()' })).rejects.toThrow();
  });

  it('aceita o par completo de câmbio', async () => {
    await inserir('e8', { exchange_rate: '5.42', exchange_rate_at: 'now()' });
    const rows = (await owner.$queryRawUnsafe(
      `SELECT exchange_rate::text AS taxa FROM estimates WHERE id = 'e8'`,
    )) as Array<{ taxa: string }>;
    expect(rows[0].taxa).toBe('5.420000');
  });

  it('sem câmbio informado, as duas colunas ficam nulas — estado legítimo', async () => {
    // §2.6: sem taxa, o custo de IA aparece em USD, rotulado, e FORA do total
    // em BRL. NULL aqui não é "falta preencher" — é o que a tela lê para não
    // fingir que converteu.
    await inserir('e9', {});
    const rows = (await owner.$queryRawUnsafe(
      `SELECT exchange_rate, exchange_rate_at FROM estimates WHERE id = 'e9'`,
    )) as Array<{ exchange_rate: unknown; exchange_rate_at: unknown }>;
    expect(rows[0]).toEqual({ exchange_rate: null, exchange_rate_at: null });
  });
});

describe('SPEC-033: parâmetros de estimativa em `tenant_settings`', () => {
  let owner: PrismaClient;

  const T = '00000000-0000-4000-8000-e57ima7e0004';

  beforeAll(async () => {
    applyMigrations();
    owner = ownerClient();
    await owner.$executeRawUnsafe(
      `INSERT INTO tenants (id, installation_id, account_login, account_type, created_at)
       VALUES ($1, NULL, 'est-set', 'User', now()) ON CONFLICT (id) DO NOTHING`,
      T,
    );
  });

  afterAll(async () => {
    await owner.$executeRawUnsafe(`DELETE FROM tenant_settings WHERE tenant_id = $1`, T);
    await owner.$executeRawUnsafe(`DELETE FROM tenants WHERE id = $1`, T);
    await owner.$disconnect();
  });

  it('nasce com os padrões da spec: R$ 200,00/hora, 15% e câmbio nulo', async () => {
    await owner.$executeRawUnsafe(
      `INSERT INTO tenant_settings (id, tenant_id, updated_at) VALUES ('ts-est', $1, now())`,
      T,
    );
    const rows = (await owner.$queryRawUnsafe(
      `SELECT hourly_rate_brl::text AS taxa, contingency_percent::text AS cont,
              exchange_rate_usd_brl AS cambio
       FROM tenant_settings WHERE tenant_id = $1`,
      T,
    )) as Array<{ taxa: string; cont: string; cambio: unknown }>;
    expect(rows[0]).toEqual({ taxa: '200.00', cont: '15.00', cambio: null });
  });

  it('recusa valor/hora zero ou negativo', async () => {
    // Valor/hora zero produziria orçamento de R$ 0,00 com aparência de conta
    // feita — o pior formato possível de erro num número que vira proposta.
    await expect(
      owner.$executeRawUnsafe(
        `UPDATE tenant_settings SET hourly_rate_brl = 0 WHERE tenant_id = $1`,
        T,
      ),
    ).rejects.toThrow();
  });

  it('recusa câmbio sem data também no tenant', async () => {
    await expect(
      owner.$executeRawUnsafe(
        `UPDATE tenant_settings SET exchange_rate_usd_brl = 5.42 WHERE tenant_id = $1`,
        T,
      ),
    ).rejects.toThrow();
  });
});
