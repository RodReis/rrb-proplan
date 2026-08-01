/**
 * `POST /errors`, a aba do admin e o purge (SPEC-043) contra Postgres REAL.
 *
 * **Por que int-spec, e não só mock.** Quatro coisas desta fatia só existem no
 * banco, e o mock afirmaria cada uma sem provar nenhuma:
 *
 * 1. **A gravação roda sob RLS.** O `create` acontece dentro de
 *    `runInTenantContext`; fora dele o RLS fail-closed **não dá erro, dá zero
 *    linhas** — a rota responderia `202` para um relato que não existe. É a
 *    mesma armadilha que a SPEC-041 pegou no PAT e a Fatia 8 nos workers.
 * 2. **O `resolve_license` é `SECURITY DEFINER`.** A rota é pública, sem sessão:
 *    um `SELECT` direto em `licenses` bateria no RLS e devolveria vazio para
 *    **toda** chave — lido aqui como "chave inválida", e nenhum relato entraria,
 *    sem um erro em log sequer.
 * 3. **O CHECK de `message` não existe no mock.** Uma mensagem em branco passa
 *    por `NOT NULL` e só o `CHECK` a barra — a mesma classe de erro do FIX #216,
 *    que passou nos unitários porque o mock do Prisma não tem constraint.
 * 4. **O isolamento entre tenants.** Um relato de outro tenant não pode aparecer
 *    na lista, e o purge de um tenant não pode apagar o relato do outro. Os dois
 *    dependem da policy, não do código.
 *
 * O caso que mais interessa é o **purge**: ele apaga em massa, e um filtro errado
 * ou contexto ausente destroem dado sem barulho nenhum.
 */
import { PrismaClient } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ownerClient, applyMigrations, grantAppRole } from '../../../test/int/db-harness';
import { ErrorReportAdminService, RETENCAO_DIAS } from './application/error-report-admin.service';
import { ErrorReportService } from './application/error-report.service';
import { hashKey } from './domain/license-key';

const TENANT = '00000000-0000-4000-8000-11fecd110061';
const OUTRO_TENANT = '00000000-0000-4000-8000-11fecd110062';

const CHAVE_ATIVA = 'WR-ER01-CD45-EF67-GH89';
const CHAVE_REVOGADA = 'WR-ER02-CD45-EF67-GH89';
const CHAVE_ALHEIA = 'WR-ER03-CD45-EF67-GH89';

const base = {
  appVersion: '1.0.2',
  os: 'win-x64',
  occurredAt: '2026-08-01T10:00:00Z',
  message: 'Erro ao abrir projeto',
  source: 'crash',
};

describe('SPEC-043: relatos de erro contra Postgres real', () => {
  let owner: PrismaClient;
  let prisma: PrismaService;
  let intake: ErrorReportService;
  let admin: ErrorReportAdminService;

  beforeAll(async () => {
    applyMigrations();
    owner = ownerClient();
    await grantAppRole(owner);

    process.env.DATABASE_URL =
      process.env.TEST_DATABASE_URL ??
      'postgresql://proplan_app:proplan_app@localhost:5433/proplan_test';
    prisma = new PrismaService();

    intake = new ErrorReportService(prisma);
    admin = new ErrorReportAdminService(prisma);

    await semear();
  });

  beforeEach(async () => {
    await owner.$executeRawUnsafe(
      `DELETE FROM lic_error_reports WHERE tenant_id = ANY($1)`,
      [TENANT, OUTRO_TENANT],
    );
  });

  afterAll(async () => {
    await limpar();
    await owner.$disconnect();
    await (prisma as unknown as PrismaClient).$disconnect();
  });

  it('chave válida persiste o relato — e ele existe DE FATO na tabela', async () => {
    // A afirmação que o mock não consegue fazer: o `202` é verdade porque a
    // linha está lá, não porque o service disse que gravou.
    await intake.receive({
      ...base,
      licenseKey: CHAVE_ATIVA,
      stack: 'at foo()',
      sessionTail: { arquivos: ['a.ts'] },
      contactEmail: 'ana@exemplo.com',
    });

    const linhas = await owner.$queryRawUnsafe<
      Array<{ message: string; tenant_id: string; contact_email: string | null }>
    >(`SELECT message, tenant_id, contact_email FROM lic_error_reports`);

    expect(linhas).toHaveLength(1);
    expect(linhas[0]).toMatchObject({
      message: 'Erro ao abrir projeto',
      tenant_id: TENANT,
      contact_email: 'ana@exemplo.com',
    });
  });

  it('chave revogada não grava nada', async () => {
    await expect(
      intake.receive({ ...base, licenseKey: CHAVE_REVOGADA }),
    ).rejects.toThrow();

    const [{ total }] = await owner.$queryRawUnsafe<Array<{ total: bigint }>>(
      `SELECT count(*) AS total FROM lic_error_reports`,
    );
    expect(Number(total)).toBe(0);
  });

  it('o CHECK barra mensagem em branco — NOT NULL sozinho a deixaria passar', async () => {
    // Mesma classe do FIX #216: o mock não tem CHECK, então só o Postgres pega.
    // Se esta expectativa parar de falhar, a guarda caiu e a lista do admin
    // passaria a ter grupos vazios.
    await expect(
      owner.$executeRawUnsafe(
        `INSERT INTO lic_error_reports (id, tenant_id, license_id, app_version, os,
                                        occurred_at, message, source, updated_at)
         VALUES ('err-branco', $1, 'erlic-ativa', '1.0.0', 'win-x64', now(), '   ',
                 'CRASH', now())`,
        TENANT,
      ),
    ).rejects.toThrow(/lic_error_reports_message_present/);
  });

  it('o admin lê o relato com o e-mail do comprador correlacionado', async () => {
    // Critério de aceite: a tabela não tem coluna de e-mail — ele vem do JOIN
    // com `licenses`, sob RLS.
    await intake.receive({ ...base, licenseKey: CHAVE_ATIVA });

    const [linha] = await prisma.runInTenantContext([TENANT], () => admin.list());
    const detalhe = (await prisma.runInTenantContext([TENANT], () =>
      admin.detail(linha.id),
    )) as unknown as { license: { customerEmail: string } };

    expect(detalhe.license.customerEmail).toBe('comprador@exemplo.com');
  });

  it('relato de OUTRO tenant nunca aparece na lista', async () => {
    // Se a policy ou o contexto falharem, o operador de um tenant leria o
    // `sessionTail` — nomes de arquivos do projeto — de cliente alheio.
    await intake.receive({ ...base, licenseKey: CHAVE_ATIVA, message: 'Erro do A' });
    await intake.receive({ ...base, licenseKey: CHAVE_ALHEIA, message: 'Erro do B' });

    const doA = await prisma.runInTenantContext([TENANT], () => admin.list());
    const doB = await prisma.runInTenantContext([OUTRO_TENANT], () => admin.list());

    expect(doA.map((r) => r.message)).toEqual(['Erro do A']);
    expect(doB.map((r) => r.message)).toEqual(['Erro do B']);
  });

  it('o agrupamento conta a tabela inteira, não a página', async () => {
    // `groupBy` no banco: agrupar em memória contaria só as linhas que a
    // paginação trouxe, e o número na tela seria menor que a realidade.
    for (let i = 0; i < 3; i += 1) {
      await intake.receive({ ...base, licenseKey: CHAVE_ATIVA, message: 'Erro repetido' });
    }
    await intake.receive({ ...base, licenseKey: CHAVE_ATIVA, message: 'Erro raro' });

    const grupos = await prisma.runInTenantContext([TENANT], () => admin.groups());

    expect(grupos.find((g) => g.message === 'Erro repetido')?.count).toBe(3);
    expect(grupos.find((g) => g.message === 'Erro raro')?.count).toBe(1);
  });

  it('o purge apaga o que passou de 90 dias e preserva o resto', async () => {
    // Critério de aceite, com relógio controlado.
    const agora = new Date('2026-08-01T12:00:00Z');
    const diasAtras = (n: number) =>
      new Date(agora.getTime() - n * 24 * 60 * 60 * 1000).toISOString();

    await inserirRelato('err-velho', TENANT, 'erlic-ativa', diasAtras(RETENCAO_DIAS + 1));
    await inserirRelato('err-novo', TENANT, 'erlic-ativa', diasAtras(1));

    const removidos = await admin.purge(TENANT, agora);

    const restantes = await owner.$queryRawUnsafe<Array<{ id: string }>>(
      `SELECT id FROM lic_error_reports ORDER BY id`,
    );
    expect(removidos).toBe(1);
    expect(restantes.map((r) => r.id)).toEqual(['err-novo']);
  });

  it('o purge de um tenant NÃO apaga o relato do outro', async () => {
    // A varredura é `deleteMany` sem `tenantId` no `where` — quem isola é a
    // policy. Se ela cair, o purge de um tenant destrói dado do outro, em massa
    // e sem barulho.
    const agora = new Date('2026-08-01T12:00:00Z');
    const velho = new Date(
      agora.getTime() - (RETENCAO_DIAS + 5) * 24 * 60 * 60 * 1000,
    ).toISOString();

    await inserirRelato('err-a', TENANT, 'erlic-ativa', velho);
    await inserirRelato('err-b', OUTRO_TENANT, 'erlic-alheia', velho);

    await admin.purge(TENANT, agora);

    const restantes = await owner.$queryRawUnsafe<Array<{ id: string }>>(
      `SELECT id FROM lic_error_reports ORDER BY id`,
    );
    expect(restantes.map((r) => r.id)).toEqual(['err-b']);
  });

  it('apagar a licença leva os relatos junto (CASCADE)', async () => {
    // O relato é diagnóstico de um app que aquela licença rodava; sem ela não
    // tem a quem responder, que é a única razão de existir.
    await inserirRelato('err-cascade', TENANT, 'erlic-descartavel', new Date().toISOString());

    await owner.$executeRawUnsafe(`DELETE FROM licenses WHERE id = 'erlic-descartavel'`);

    const [{ total }] = await owner.$queryRawUnsafe<Array<{ total: bigint }>>(
      `SELECT count(*) AS total FROM lic_error_reports WHERE id = 'err-cascade'`,
    );
    expect(Number(total)).toBe(0);

    await semearLicencaDescartavel();
  });

  async function inserirRelato(
    id: string,
    tenant: string,
    licenca: string,
    receivedAt: string,
  ) {
    await owner.$executeRawUnsafe(
      `INSERT INTO lic_error_reports (id, tenant_id, license_id, app_version, os,
                                      occurred_at, received_at, message, source, updated_at)
       VALUES ($1, $2, $3, '1.0.0', 'win-x64', $4::timestamptz, $4::timestamptz,
               'Erro semeado', 'CRASH', now())`,
      id,
      tenant,
      licenca,
      receivedAt,
    );
  }

  async function semearLicencaDescartavel() {
    await owner.$executeRawUnsafe(
      `INSERT INTO licenses (id, tenant_id, edition_id, key_hash, status,
                             customer_email, issued_at, updates_until, created_at, updated_at)
       VALUES ('erlic-descartavel', $1, 'eredi-a', $2, 'ACTIVE', 'x@exemplo.com',
               now(), '2027-12-31'::timestamp, now(), now())
       ON CONFLICT (id) DO NOTHING`,
      TENANT,
      hashKey('WR-ER99-CD45-EF67-GH89'),
    );
  }

  async function semear() {
    const tenants: Array<[string, string, string, string, string]> = [
      [TENANT, 'a', 'erprod-a', 'eredi-a', 'warroom'],
      [OUTRO_TENANT, 'b', 'erprod-b', 'eredi-b', 'outro'],
    ];

    for (const [tenant, sufixo, produto, edicao, slug] of tenants) {
      await owner.$executeRawUnsafe(
        `INSERT INTO tenants (id, installation_id, account_login, account_type, created_at)
         VALUES ($1, NULL, $2, 'User', now()) ON CONFLICT (id) DO NOTHING`,
        tenant,
        `er-${sufixo}`,
      );
      await owner.$executeRawUnsafe(
        `INSERT INTO lic_products (id, tenant_id, slug, name, key_prefix, created_at, updated_at)
         VALUES ($1, $2, $3, 'Produto', 'WR', now(), now()) ON CONFLICT (id) DO NOTHING`,
        produto,
        tenant,
        slug,
      );
      await owner.$executeRawUnsafe(
        `INSERT INTO lic_editions (id, product_id, slug, name, billing_model,
                                   max_machines, updates_months, created_at, updated_at)
         VALUES ($1, $2, 'padrao', 'Padrão', 'PERPETUAL', 2, 12, now(), now())
         ON CONFLICT (id) DO NOTHING`,
        edicao,
        produto,
      );
    }

    const licencas: Array<[string, string, string, string, string]> = [
      ['erlic-ativa', TENANT, 'eredi-a', CHAVE_ATIVA, 'ACTIVE'],
      ['erlic-revogada', TENANT, 'eredi-a', CHAVE_REVOGADA, 'REVOKED'],
      ['erlic-alheia', OUTRO_TENANT, 'eredi-b', CHAVE_ALHEIA, 'ACTIVE'],
    ];

    for (const [id, tenant, edicao, chave, status] of licencas) {
      // `revoked_at`/`revoked_reason` acompanham o `REVOKED`: o CHECK
      // `licenses_revoked_coherent` recusa o status sem a data — é a guarda que
      // impede a linha que diz "revogada" sem dizer quando nem por quê.
      await owner.$executeRawUnsafe(
        `INSERT INTO licenses (id, tenant_id, edition_id, key_hash, status,
                               customer_email, issued_at, updates_until,
                               revoked_at, revoked_reason, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5::"LicenseStatus", 'comprador@exemplo.com', now(),
                 '2027-12-31'::timestamp,
                 CASE WHEN $5 = 'REVOKED' THEN now() ELSE NULL END,
                 CASE WHEN $5 = 'REVOKED' THEN 'reembolso' ELSE NULL END,
                 now(), now())
         ON CONFLICT (id) DO NOTHING`,
        id,
        tenant,
        edicao,
        hashKey(chave),
        status,
      );
    }

    await semearLicencaDescartavel();
  }

  async function limpar() {
    const ids = [TENANT, OUTRO_TENANT];
    await owner.$executeRawUnsafe(
      `DELETE FROM lic_error_reports WHERE tenant_id = ANY($1)`,
      ids,
    );
    await owner.$executeRawUnsafe(`DELETE FROM lic_events WHERE tenant_id = ANY($1)`, ids);
    await owner.$executeRawUnsafe(`DELETE FROM licenses WHERE tenant_id = ANY($1)`, ids);
    await owner.$executeRawUnsafe(`DELETE FROM lic_editions WHERE id = ANY($1)`, [
      'eredi-a',
      'eredi-b',
    ]);
    await owner.$executeRawUnsafe(`DELETE FROM lic_products WHERE tenant_id = ANY($1)`, ids);
    await owner.$executeRawUnsafe(`DELETE FROM tenants WHERE id = ANY($1)`, ids);
  }
});
