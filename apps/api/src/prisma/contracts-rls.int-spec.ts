/**
 * Contratos contra Postgres REAL: isolamento, as barreiras que só o banco
 * garante e o lookup público sem sessão (SPEC-034 §5, ADR-020).
 *
 * Por que int-spec e não mock, aqui especificamente: esta é a fatia com o maior
 * custo de erro do MVP3 (#149). Ela expõe **dado pessoal de duas partes** numa
 * URL sem autenticação e produz um documento que alguém pode tratar como
 * vinculante. Os modos de errar abaixo são todos silenciosos — nenhum levanta
 * exceção no caminho feliz:
 *
 * 1. **Fail-closed sem contexto.** `GET /c/:token` não tem sessão. Ler sem
 *    contexto não dá erro, dá ZERO LINHAS — e todo token válido responderia
 *    "inválido". 5 ocorrências desta classe nesta frente; a `resolve_contract_link`
 *    existe por causa dela, e **este teste vem antes do controller** (§7.2).
 * 2. **Aceite sem ator.** É o ato que move o card para `CONTRACT_APPROVED`. Um
 *    contrato "aceito por ninguém" é o fechamento frágil que este produto
 *    existe para detectar.
 * 3. **Snapshot que não é snapshot.** Se o contrato lesse cliente/estimativa por
 *    relação, editar a origem reescreveria em silêncio um documento já enviado.
 * 4. **Link sem prazo.** Aqui a expiração é NOT NULL, ao contrário do briefing:
 *    link sem prazo é dado pessoal legível para sempre por quem tiver a URL.
 */
import { PrismaClient } from '@prisma/client';
import { createHash } from 'node:crypto';
import { ownerClient, appClient, applyMigrations, grantAppRole } from '../../test/int/db-harness';

const TENANT_A = '00000000-0000-4000-8000-c0117ac70001';
const TENANT_B = '00000000-0000-4000-8000-c0117ac70002';

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

/** Mesma função do domain (`hashToken`) — SHA-256 hex. */
function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

const SNAPSHOT = `'{"legalName":"Fulano"}'::jsonb`;

/** Monta o encadeamento tenant → cliente → projeto → artefato → estimativa. */
async function semearProjeto(
  owner: PrismaClient,
  tenant: string,
  sufixo: string,
): Promise<void> {
  await owner.$executeRawUnsafe(
    `INSERT INTO tenants (id, installation_id, account_login, account_type, created_at)
     VALUES ($1, NULL, $2, 'User', now()) ON CONFLICT (id) DO NOTHING`,
    tenant,
    `ctr-${sufixo}`,
  );
  await owner.$executeRawUnsafe(
    `INSERT INTO clients (id, tenant_id, name, created_at, updated_at)
     VALUES ($1, $2, 'Cliente', now(), now()) ON CONFLICT (id) DO NOTHING`,
    `ccli-${sufixo}`,
    tenant,
  );
  await owner.$executeRawUnsafe(
    `INSERT INTO client_projects (id, client_id, title, state, created_at, updated_at)
     VALUES ($1, $2, 'Projeto', 'CONTRACT_PENDING', now(), now()) ON CONFLICT (id) DO NOTHING`,
    `ccp-${sufixo}`,
    `ccli-${sufixo}`,
  );
  await owner.$executeRawUnsafe(
    `INSERT INTO artifacts (id, tenant_id, client_project_id, kind, state, created_at, updated_at)
     VALUES ($1, $2, $3, 'effort_breakdown', 'APPROVED', now(), now()) ON CONFLICT (id) DO NOTHING`,
    `cart-${sufixo}`,
    tenant,
    `ccp-${sufixo}`,
  );
  await owner.$executeRawUnsafe(
    `INSERT INTO artifact_versions (id, tenant_id, artifact_id, version, content, author, input_hash, created_at)
     VALUES ($1, $2, $3, 1, '{"tarefas":[]}'::jsonb, 'ai', $4, now()) ON CONFLICT (id) DO NOTHING`,
    `cav-${sufixo}`,
    tenant,
    `cart-${sufixo}`,
    `cih-${sufixo}`,
  );
  await owner.$executeRawUnsafe(
    `INSERT INTO estimates (
       id, tenant_id, client_project_id, version, effort_version_id,
       hourly_rate_brl, contingency_percent, complexity, complexity_factor,
       direct_costs, ai_cost_incurred_usd, ai_cost_projected,
       scenarios, mvp_breakdown, approved_at, approved_by, created_at
     ) VALUES ($1, $2, $3, 1, $4, 200, 15, 'media', 1.0000,
               '[]'::jsonb, 0.045, '{"valueUsd":0.05,"isCalculated":false}'::jsonb,
               '{"provavel":{"horas":"20.00","totalBrl":"4600.00"}}'::jsonb,
               '[]'::jsonb, now(), 'u1', now())
     ON CONFLICT (id) DO NOTHING`,
    `cest-${sufixo}`,
    tenant,
    `ccp-${sufixo}`,
    `cav-${sufixo}`,
  );
  await owner.$executeRawUnsafe(
    `INSERT INTO contract_templates (id, tenant_id, modality, is_seed_example, created_at, updated_at)
     VALUES ($1, $2, 'desenvolvimento', false, now(), now()) ON CONFLICT (id) DO NOTHING`,
    `ctpl-${sufixo}`,
    tenant,
  );
  await owner.$executeRawUnsafe(
    `INSERT INTO contract_template_versions (id, template_id, version, body, created_at)
     VALUES ($1, $2, 1, 'Contrato de {{client_name}}', now()) ON CONFLICT (id) DO NOTHING`,
    `ctv-${sufixo}`,
    `ctpl-${sufixo}`,
  );
  await owner.$executeRawUnsafe(
    `UPDATE contract_templates SET current_version_id = $1 WHERE id = $2`,
    `ctv-${sufixo}`,
    `ctpl-${sufixo}`,
  );
}

async function limparProjeto(owner: PrismaClient, tenants: string[]): Promise<void> {
  await owner.$executeRawUnsafe(`DELETE FROM contract_links WHERE contract_id IN (SELECT id FROM contracts WHERE tenant_id = ANY($1))`, tenants);
  await owner.$executeRawUnsafe(`DELETE FROM contracts WHERE tenant_id = ANY($1)`, tenants);
  await owner.$executeRawUnsafe(`DELETE FROM contract_template_versions WHERE template_id IN (SELECT id FROM contract_templates WHERE tenant_id = ANY($1))`, tenants);
  await owner.$executeRawUnsafe(`DELETE FROM contract_templates WHERE tenant_id = ANY($1)`, tenants);
  await owner.$executeRawUnsafe(`DELETE FROM provider_profiles WHERE tenant_id = ANY($1)`, tenants);
  await owner.$executeRawUnsafe(`DELETE FROM estimates WHERE tenant_id = ANY($1)`, tenants);
  await owner.$executeRawUnsafe(`DELETE FROM artifact_versions WHERE tenant_id = ANY($1)`, tenants);
  await owner.$executeRawUnsafe(`DELETE FROM artifacts WHERE tenant_id = ANY($1)`, tenants);
  await owner.$executeRawUnsafe(`DELETE FROM clients WHERE tenant_id = ANY($1)`, tenants);
  await owner.$executeRawUnsafe(`DELETE FROM tenants WHERE id = ANY($1)`, tenants);
}

describe('SPEC-034: isolamento das tabelas de contrato', () => {
  let owner: PrismaClient;
  let app: PrismaClient;

  beforeAll(async () => {
    applyMigrations();
    owner = ownerClient();
    app = appClient(1);
    await grantAppRole(owner);

    for (const [tenant, sufixo] of [
      [TENANT_A, 'a'],
      [TENANT_B, 'b'],
    ] as const) {
      await semearProjeto(owner, tenant, sufixo);
      await owner.$executeRawUnsafe(
        `INSERT INTO provider_profiles (id, tenant_id, legal_name, document_type, document, created_at, updated_at)
         VALUES ($1, $2, 'Prestador', 'cnpj', '00000000000191', now(), now()) ON CONFLICT (id) DO NOTHING`,
        `cpp-${sufixo}`,
        tenant,
      );
      await owner.$executeRawUnsafe(
        `INSERT INTO contracts (
           id, tenant_id, client_project_id, version, modality, estimate_id,
           template_version_id, rendered_html, provider_snapshot, client_snapshot,
           scope_snapshot, budget_brl, effort_hours, created_at
         ) VALUES ($1, $2, $3, 1, 'desenvolvimento', $4, $5, '<p>contrato</p>',
                   ${SNAPSHOT}, ${SNAPSHOT}, '{}'::jsonb, 4600.00, 20.00, now())
         ON CONFLICT (id) DO NOTHING`,
        `cctr-${sufixo}`,
        tenant,
        `ccp-${sufixo}`,
        `cest-${sufixo}`,
        `ctv-${sufixo}`,
      );
      await owner.$executeRawUnsafe(
        `INSERT INTO contract_links (id, contract_id, token_hash, expires_at, created_at)
         VALUES ($1, $2, $3, now() + interval '48 hours', now()) ON CONFLICT (id) DO NOTHING`,
        `clink-${sufixo}`,
        `cctr-${sufixo}`,
        hashToken(`token-${sufixo}`),
      );
    }
  });

  afterAll(async () => {
    await limparProjeto(owner, [TENANT_A, TENANT_B]);
    await owner.$disconnect();
    await app.$disconnect();
  });

  it.each([
    ['provider_profiles'],
    ['contract_templates'],
    ['contract_template_versions'],
    ['contracts'],
    ['contract_links'],
  ])('sem contexto de tenant, %s devolve zero linhas (fail-closed)', async (tabela) => {
    const rows = (await app.$queryRawUnsafe(`SELECT id FROM ${tabela}`)) as unknown[];
    expect(rows).toHaveLength(0);
  });

  it('com contexto, o tenant só enxerga os próprios contratos', async () => {
    const rows = await withTenant(app, [TENANT_A], (tx) =>
      tx.$queryRawUnsafe(`SELECT id FROM contracts`),
    );
    expect(rows).toEqual([{ id: 'cctr-a' }]);
  });

  it('as filhas por JOIN herdam o corte da raiz', async () => {
    // `contract_template_versions` e `contract_links` não têm `tenant_id`: o
    // corte vem do pai. Se a policy delas estivesse errada, o texto do template
    // e o ciclo de vida do link de outro tenant sairiam numa listagem.
    const versoes = await withTenant(app, [TENANT_A], (tx) =>
      tx.$queryRawUnsafe(`SELECT id FROM contract_template_versions`),
    );
    const links = await withTenant(app, [TENANT_A], (tx) =>
      tx.$queryRawUnsafe(`SELECT id FROM contract_links`),
    );
    expect(versoes).toEqual([{ id: 'ctv-a' }]);
    expect(links).toEqual([{ id: 'clink-a' }]);
  });

  it('pedir o contrato do outro tenant devolve vazio, não erro', async () => {
    // §5: inexistente e alheio têm de ser indistinguíveis. Distinguir os dois já
    // é vazamento — confirma que aquele id existe em algum lugar, e o id de um
    // contrato aparece em URL.
    const doOutro = await withTenant(app, [TENANT_A], (tx) =>
      tx.$queryRawUnsafe(`SELECT id FROM contracts WHERE id = 'cctr-b'`),
    );
    const inexistente = await withTenant(app, [TENANT_A], (tx) =>
      tx.$queryRawUnsafe(`SELECT id FROM contracts WHERE id = 'nao-existe'`),
    );
    expect(doOutro).toEqual([]);
    expect(doOutro).toEqual(inexistente);
  });

  it('refazer o contrato cria v2 e a v1 permanece inalterada (§2.5)', async () => {
    await owner.$executeRawUnsafe(
      `INSERT INTO contracts (
         id, tenant_id, client_project_id, version, modality, estimate_id,
         template_version_id, rendered_html, provider_snapshot, client_snapshot,
         scope_snapshot, budget_brl, effort_hours, created_at
       ) VALUES ('cctr-a-v2', $1, 'ccp-a', 2, 'desenvolvimento', 'cest-a', 'ctv-a',
                 '<p>v2</p>', ${SNAPSHOT}, ${SNAPSHOT}, '{}'::jsonb, 5000.00, 25.00, now())`,
      TENANT_A,
    );

    const rows = (await owner.$queryRawUnsafe(
      `SELECT version, budget_brl::text AS valor, rendered_html AS html
       FROM contracts WHERE client_project_id = 'ccp-a' ORDER BY version`,
    )) as Array<{ version: number; valor: string; html: string }>;

    expect(rows).toEqual([
      { version: 1, valor: '4600.00', html: '<p>contrato</p>' },
      { version: 2, valor: '5000.00', html: '<p>v2</p>' },
    ]);

    await owner.$executeRawUnsafe(`DELETE FROM contracts WHERE id = 'cctr-a-v2'`);
  });

  it('recusa dois contratos com a mesma versão no mesmo projeto', async () => {
    await expect(
      owner.$executeRawUnsafe(
        `INSERT INTO contracts (
           id, tenant_id, client_project_id, version, modality, estimate_id,
           template_version_id, rendered_html, provider_snapshot, client_snapshot,
           scope_snapshot, budget_brl, effort_hours, created_at
         ) VALUES ('cctr-a-dup', $1, 'ccp-a', 1, 'desenvolvimento', 'cest-a', 'ctv-a',
                   '<p>dup</p>', ${SNAPSHOT}, ${SNAPSHOT}, '{}'::jsonb, 100.00, 1.00, now())`,
        TENANT_A,
      ),
    ).rejects.toThrow();
  });

  it('recusa apagar a estimativa que originou o contrato', async () => {
    // FK `RESTRICT`: a estimativa é a CONTA que explica o valor do contrato.
    // `CASCADE` levaria junto um documento já enviado ao cliente; `SET NULL`
    // deixaria o número órfão da conta — auditável deixaria de ser auditável.
    await expect(
      owner.$executeRawUnsafe(`DELETE FROM estimates WHERE id = 'cest-a'`),
    ).rejects.toThrow();
  });

  it('recusa apagar a versão do template de que o contrato saiu', async () => {
    await expect(
      owner.$executeRawUnsafe(`DELETE FROM contract_template_versions WHERE id = 'ctv-a'`),
    ).rejects.toThrow();
  });

  it('recusa um segundo perfil de prestador no mesmo tenant (§2.1)', async () => {
    // Dois perfis significaria que a emissão precisaria escolher um, e nada
    // diria qual.
    await expect(
      owner.$executeRawUnsafe(
        `INSERT INTO provider_profiles (id, tenant_id, legal_name, document_type, document, created_at, updated_at)
         VALUES ('cpp-dup', $1, 'Outro', 'cpf', '11111111111', now(), now())`,
        TENANT_A,
      ),
    ).rejects.toThrow();
  });

  it('recusa dois templates da mesma modalidade no mesmo tenant (§2.2)', async () => {
    await expect(
      owner.$executeRawUnsafe(
        `INSERT INTO contract_templates (id, tenant_id, modality, created_at, updated_at)
         VALUES ('ctpl-dup', $1, 'desenvolvimento', now(), now())`,
        TENANT_A,
      ),
    ).rejects.toThrow();
  });
});

describe('SPEC-034: as barreiras do contrato no banco', () => {
  let owner: PrismaClient;

  const T = '00000000-0000-4000-8000-c0117ac70003';

  // Versão distinta a cada inserção: o unique `(client_project_id, version)` é
  // real, e reaproveitar o número faria os testes de CHECK falharem pelo motivo
  // errado — passariam a provar o unique em vez da barreira que dizem provar.
  let proximaVersao = 1;

  /** Insere um contrato completando o mínimo; `cols` sobrescreve colunas. */
  async function inserir(id: string, cols: Record<string, string>): Promise<void> {
    const base: Record<string, string> = {
      rendered_html: `'<p>contrato</p>'`,
      provider_snapshot: SNAPSHOT,
      client_snapshot: SNAPSHOT,
      scope_snapshot: `'{}'::jsonb`,
      budget_brl: '4600.00',
      effort_hours: '20.00',
      accepted_at: 'NULL',
      accepted_by: 'NULL',
      acceptance_channel: 'NULL',
      ...cols,
    };
    const nomes = Object.keys(base).join(', ');
    const valores = Object.values(base).join(', ');
    await owner.$executeRawUnsafe(
      `INSERT INTO contracts (id, tenant_id, client_project_id, version, modality,
                              estimate_id, template_version_id, ${nomes}, created_at)
       VALUES ('${id}', '${T}', 'ccp-chk', ${proximaVersao++}, 'desenvolvimento',
               'cest-chk', 'ctv-chk', ${valores}, now())`,
    );
  }

  beforeAll(async () => {
    applyMigrations();
    owner = ownerClient();
    await semearProjeto(owner, T, 'chk');
  });

  afterAll(async () => {
    await limparProjeto(owner, [T]);
    await owner.$disconnect();
  });

  it('recusa aceite sem ator (§2.10: ator nunca nulo)', async () => {
    // Este é o ato que move o card para `CONTRACT_APPROVED`. Sem ator, o funil
    // avança e a trilha não sabe dizer por decisão de quem — o fechamento
    // frágil que este produto existe para detectar.
    await expect(
      inserir('k1', { accepted_at: 'now()', acceptance_channel: `'email'` }),
    ).rejects.toThrow();
  });

  it('recusa aceite sem canal', async () => {
    await expect(
      inserir('k2', { accepted_at: 'now()', accepted_by: `'u1'` }),
    ).rejects.toThrow();
  });

  it('recusa ator sem data de aceite', async () => {
    await expect(
      inserir('k3', { accepted_by: `'u1'`, acceptance_channel: `'email'` }),
    ).rejects.toThrow();
  });

  it('aceita o trio completo de aceite', async () => {
    await inserir('k4', {
      accepted_at: 'now()',
      accepted_by: `'u1'`,
      acceptance_channel: `'whatsapp'`,
    });
    const rows = (await owner.$queryRawUnsafe(
      `SELECT accepted_by, acceptance_channel::text AS canal FROM contracts WHERE id = 'k4'`,
    )) as Array<{ accepted_by: string; canal: string }>;
    expect(rows[0]).toEqual({ accepted_by: 'u1', canal: 'whatsapp' });
  });

  it('a observação do aceite é opcional e não entra no trio', async () => {
    await inserir('k5', {
      accepted_at: 'now()',
      accepted_by: `'u1'`,
      acceptance_channel: `'presencial'`,
      acceptance_note: `'combinado na reunião'`,
    });
    const rows = (await owner.$queryRawUnsafe(
      `SELECT acceptance_note AS nota FROM contracts WHERE id = 'k5'`,
    )) as Array<{ nota: string }>;
    expect(rows[0].nota).toBe('combinado na reunião');
  });

  it('recusa canal fora da lista fechada (§8.3)', async () => {
    await expect(
      inserir('k6', {
        accepted_at: 'now()',
        accepted_by: `'u1'`,
        acceptance_channel: `'pombo-correio'`,
      }),
    ).rejects.toThrow();
  });

  it('recusa valor zero ou negativo', async () => {
    // R$ 0,00 COM APARÊNCIA de conta feita, dentro de um documento que o cliente
    // pode tratar como vinculante — o pior formato possível de erro aqui.
    await expect(inserir('k7', { budget_brl: '0' })).rejects.toThrow();
    await expect(inserir('k8', { budget_brl: '-100' })).rejects.toThrow();
  });

  it('recusa horas zero ou negativas', async () => {
    await expect(inserir('k9', { effort_hours: '0' })).rejects.toThrow();
  });

  it('recusa contrato com corpo renderizado vazio', async () => {
    // Documento em branco que a rota pública serviria como se fosse o contrato.
    await expect(inserir('k10', { rendered_html: `'   '` })).rejects.toThrow();
  });

  it('recusa perfil de prestador sem nome ou sem documento', async () => {
    // Uma das partes ficaria não identificada no contrato — e a string vazia é
    // o que passa por NOT NULL sem dizer nada.
    await expect(
      owner.$executeRawUnsafe(
        `INSERT INTO provider_profiles (id, tenant_id, legal_name, document_type, document, created_at, updated_at)
         VALUES ('cpp-vazio', $1, '  ', 'cnpj', '00000000000191', now(), now())`,
        T,
      ),
    ).rejects.toThrow();
  });

  it('recusa tipo de documento fora de cpf|cnpj', async () => {
    // O tipo decide o rótulo no contrato ("CPF nº" vs "CNPJ nº"). Um valor fora
    // dos dois produziria rótulo errado no dado que identifica a parte.
    await expect(
      owner.$executeRawUnsafe(
        `INSERT INTO provider_profiles (id, tenant_id, legal_name, document_type, document, created_at, updated_at)
         VALUES ('cpp-tipo', $1, 'Prestador', 'rg', '123', now(), now())`,
        T,
      ),
    ).rejects.toThrow();
  });

  it('recusa versão de template com corpo vazio', async () => {
    await expect(
      owner.$executeRawUnsafe(
        `INSERT INTO contract_template_versions (id, template_id, version, body, created_at)
         VALUES ('ctv-vazio', 'ctpl-chk', 99, '   ', now())`,
      ),
    ).rejects.toThrow();
  });

  it('recusa link que expira antes de nascer', async () => {
    // Barra o erro de sinal no cálculo das 48 h: um link morto que a tela
    // mostraria como recém-criado.
    await inserir('k11', {});
    await expect(
      owner.$executeRawUnsafe(
        `INSERT INTO contract_links (id, contract_id, token_hash, expires_at, created_at)
         VALUES ('clink-passado', 'k11', 'hash-passado', now() - interval '1 hour', now())`,
      ),
    ).rejects.toThrow();
  });

  it('o link de contrato exige expiração — não existe link sem prazo', async () => {
    // Diferença deliberada em relação ao `briefing_links`, onde `expires_at` é
    // nullable: aqui o link expõe CPF/CNPJ e endereço das duas partes (§2.7), e
    // um link sem prazo seria dado pessoal legível para sempre por quem tiver a
    // URL. A coluna NOT NULL é o que impede o "esqueci de definir".
    await inserir('k12', {});
    await expect(
      owner.$executeRawUnsafe(
        `INSERT INTO contract_links (id, contract_id, token_hash, created_at)
         VALUES ('clink-sem-prazo', 'k12', 'hash-sem-prazo', now())`,
      ),
    ).rejects.toThrow();
  });
});

/**
 * O lookup público — **escrito antes do controller**, como o §7.2 item 5 exige.
 *
 * Escrito depois, ele documentaria o que foi construído em vez de barrar o que
 * não pode existir. É a 6ª ocorrência da classe "rota pública + RLS
 * fail-closed" nesta frente, e a primeira a ser testada antes de o caminho
 * existir.
 */
describe('SPEC-034: resolve_contract_link (rota pública, sem sessão)', () => {
  let owner: PrismaClient;
  let app: PrismaClient;

  const T = '00000000-0000-4000-8000-c0117ac70004';
  const TOKEN_VALIDO = 'token-publico-valido';
  const TOKEN_REVOGADO = 'token-publico-revogado';

  type Resolvido = {
    id: string;
    expires_at: Date | null;
    revoked_at: Date | null;
    tenant_id: string;
    contract_id: string;
    client_project_id: string;
  };

  async function resolver(client: PrismaClient, token: string): Promise<Resolvido[]> {
    return client.$queryRawUnsafe(
      `SELECT * FROM resolve_contract_link($1)`,
      hashToken(token),
    ) as Promise<Resolvido[]>;
  }

  beforeAll(async () => {
    applyMigrations();
    owner = ownerClient();
    app = appClient(1);
    await grantAppRole(owner);
    await semearProjeto(owner, T, 'pub');

    await owner.$executeRawUnsafe(
      `INSERT INTO contracts (
         id, tenant_id, client_project_id, version, modality, estimate_id,
         template_version_id, rendered_html, provider_snapshot, client_snapshot,
         scope_snapshot, budget_brl, effort_hours, created_at
       ) VALUES ('cctr-pub', $1, 'ccp-pub', 1, 'desenvolvimento', 'cest-pub', 'ctv-pub',
                 '<p>contrato</p>', ${SNAPSHOT}, ${SNAPSHOT}, '{}'::jsonb, 4600.00, 20.00, now())`,
      T,
    );
    await owner.$executeRawUnsafe(
      `INSERT INTO contract_links (id, contract_id, token_hash, expires_at, created_at)
       VALUES ('clink-pub', 'cctr-pub', $1, now() + interval '48 hours', now())`,
      hashToken(TOKEN_VALIDO),
    );
    await owner.$executeRawUnsafe(
      `INSERT INTO contract_links (id, contract_id, token_hash, expires_at, revoked_at, created_at)
       VALUES ('clink-rev', 'cctr-pub', $1, now() + interval '48 hours', now(), now())`,
      hashToken(TOKEN_REVOGADO),
    );
  });

  afterAll(async () => {
    await limparProjeto(owner, [T]);
    await owner.$disconnect();
    await app.$disconnect();
  });

  it('SELECT direto sem contexto devolve zero — é o bug que a função existe para evitar', async () => {
    // Esta asserção é o **motivo** da função. Sem ela, o controller público
    // faria este SELECT, receberia zero linhas e responderia "inválido" para
    // todo token legítimo — sem erro nenhum no log. Aconteceu no dogfooding de
    // 2026-07-25 com o briefing.
    const rows = (await app.$queryRawUnsafe(
      `SELECT id FROM contract_links WHERE token_hash = $1`,
      hashToken(TOKEN_VALIDO),
    )) as unknown[];
    expect(rows).toHaveLength(0);
  });

  it('a função resolve o token válido sem contexto de tenant', async () => {
    const rows = await resolver(app, TOKEN_VALIDO);
    expect(rows).toHaveLength(1);
    expect(rows[0].tenant_id).toBe(T);
    expect(rows[0].contract_id).toBe('cctr-pub');
    expect(rows[0].client_project_id).toBe('ccp-pub');
    expect(rows[0].revoked_at).toBeNull();
  });

  it('devolve o estado do link revogado — quem tem link legítimo precisa saber por quê', async () => {
    const rows = await resolver(app, TOKEN_REVOGADO);
    expect(rows).toHaveLength(1);
    expect(rows[0].revoked_at).not.toBeNull();
  });

  it('token inexistente devolve vazio, não erro', async () => {
    await expect(resolver(app, 'nao-existe')).resolves.toEqual([]);
  });

  it('não devolve o corpo do contrato', async () => {
    // A função responde "este token serve, e para qual contrato?". O documento é
    // lido depois, já sob o contexto do tenant que ela devolveu — assim o RLS
    // continua sendo o que protege o conteúdo, e não a lista de colunas de uma
    // função privilegiada.
    const rows = await resolver(app, TOKEN_VALIDO);
    expect(Object.keys(rows[0]).sort()).toEqual([
      'client_project_id',
      'contract_id',
      'expires_at',
      'id',
      'revoked_at',
      'tenant_id',
    ]);
  });

  it('não resolve link de projeto ou cliente excluído logicamente', async () => {
    // Exclusão lógica (SPEC-029) tem de derrubar o acesso público junto: o
    // cliente sumiu das listas do prestador, e o link continuar servindo o
    // contrato dele seria um acesso que ninguém mais enxerga para revogar.
    await owner.$executeRawUnsafe(
      `UPDATE client_projects SET deleted_at = now() WHERE id = 'ccp-pub'`,
    );
    await expect(resolver(app, TOKEN_VALIDO)).resolves.toEqual([]);
    await owner.$executeRawUnsafe(
      `UPDATE client_projects SET deleted_at = NULL WHERE id = 'ccp-pub'`,
    );
  });

  it('a função não aceita filtro livre — não há como enumerar', async () => {
    // Superfície mínima: um argumento, o hash. Não lista, não pagina. Um hash
    // que não existe não vira listagem parcial.
    const rows = await resolver(app, '');
    expect(rows).toEqual([]);
  });
});
