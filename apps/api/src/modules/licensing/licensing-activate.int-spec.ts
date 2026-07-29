/**
 * `POST /licensing/v1/activate` contra Postgres REAL (SPEC-036 §Contratos).
 *
 * **Por que int-spec e não mock, aqui especificamente.** Esta rota é a única do
 * produto que roda **sem sessão e escreve**. As três coisas que podem dar
 * errado nela são todas silenciosas com mock:
 *
 * 1. **Fail-closed.** Sem `runInTenantContext`, o `create` da `Activation` não
 *    dá erro — grava ZERO LINHAS. A rota devolveria `200` com um license file
 *    válido para uma ativação que não existe, e o comprador só descobriria ao
 *    perder a máquina na primeira revalidação. Um mock do Prisma "gravaria"
 *    normalmente e o teste passaria.
 * 2. **`resolve_license` sem `EXECUTE`.** O `DROP FUNCTION` da migração de
 *    emenda leva os privilégios junto. Com mock, ninguém percebe; aqui, a role
 *    `proplan_app` é a mesma da aplicação e o erro aparece.
 * 3. **A vaga da 3ª máquina.** É o unique `(license_id, fingerprint)` e a
 *    contagem que decidem — nenhum dos dois existe num objeto de mentira.
 */
import { PrismaClient } from '@prisma/client';
import { generateKeyPairSync } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import {
  ownerClient,
  applyMigrations,
  grantAppRole,
} from '../../../test/int/db-harness';
import { LicenseActivationService } from './application/license-activation.service';
import { LicenseSigningService } from './application/license-signing.service';
import { hashKey } from './domain/license-key';
import { verifyLicenseFile } from './domain/license-file';

const TENANT = '00000000-0000-4000-8000-ac71ba7e0001';
const CHAVE = 'WR-AB23-CD45-EF67-GH89';
const CHAVE_REVOGADA = 'WR-RV23-CD45-EF67-GH89';
const CHAVE_EXPIRADA = 'WR-XP23-CD45-EF67-GH89';

describe('SPEC-036: POST /licensing/v1/activate', () => {
  let owner: PrismaClient;
  let prisma: PrismaService;
  let service: LicenseActivationService;
  let publicaPem: string;

  beforeAll(async () => {
    applyMigrations();
    owner = ownerClient();
    await grantAppRole(owner);

    // Par efêmero: nenhuma chave real no repo nem no ambiente.
    const { privateKey, publicKey } = generateKeyPairSync('ed25519');
    process.env.LICENSING_SIGNING_KEY = privateKey
      .export({ type: 'pkcs8', format: 'pem' })
      .toString();
    process.env.LICENSING_SIGNING_KID = '2026-07';
    publicaPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();

    // `PrismaService` de verdade, não `appClient` do harness: é dele que vem o
    // `runInTenantContext`, e é justamente esse caminho que este teste existe
    // para exercer.
    //
    // `DATABASE_URL` precisa ser reapontada ANTES de instanciar: o
    // `PrismaService` chama `super()` sem `datasources`, então lê a variável do
    // ambiente — que no `.env` aponta para o banco de DEV. Sem esta linha o
    // service conectaria em `proplan` enquanto o seed grava em `proplan_test`,
    // e todo teste daria 404 numa chave que existe (foi o que aconteceu).
    process.env.DATABASE_URL =
      process.env.TEST_DATABASE_URL ??
      'postgresql://proplan_app:proplan_app@localhost:5433/proplan_test';
    prisma = new PrismaService();
    service = new LicenseActivationService(prisma, new LicenseSigningService());

    await semear();
  });

  afterAll(async () => {
    await limpar();
    await owner.$disconnect();
    await (prisma as unknown as PrismaClient).$disconnect();
  });

  beforeEach(async () => {
    // Cada teste começa sem máquina ativada: a contagem de vagas é o que vários
    // deles exercem, e um resíduo do anterior falsearia o resultado.
    await owner.$executeRawUnsafe(
      `DELETE FROM lic_activations WHERE tenant_id = $1`,
      TENANT,
    );
    await owner.$executeRawUnsafe(`DELETE FROM lic_events WHERE tenant_id = $1`, TENANT);
  });

  async function semear() {
    await owner.$executeRawUnsafe(
      `INSERT INTO tenants (id, installation_id, account_login, account_type, created_at)
       VALUES ($1, NULL, 'act-t', 'User', now()) ON CONFLICT (id) DO NOTHING`,
      TENANT,
    );
    await owner.$executeRawUnsafe(
      `INSERT INTO lic_products (id, tenant_id, slug, name, key_prefix, created_at, updated_at)
       VALUES ('aprod', $1, 'warroom', 'War Room', 'WR', now(), now())
       ON CONFLICT (id) DO NOTHING`,
      TENANT,
    );
    await owner.$executeRawUnsafe(
      `INSERT INTO lic_editions (id, product_id, slug, name, billing_model,
                                 max_machines, updates_months, created_at, updated_at)
       VALUES ('aedi', 'aprod', 'closed', 'Sem código-fonte', 'PERPETUAL', 2, 12, now(), now())
       ON CONFLICT (id) DO NOTHING`,
    );

    const licencas: Array<[string, string, string, string | null, string | null]> = [
      ['alic', hashKey(CHAVE), 'ACTIVE', null, null],
      ['alic-rev', hashKey(CHAVE_REVOGADA), 'REVOKED', 'now()', null],
      // Expirada: SUBSCRIPTION com `expires_at` no passado.
      ['alic-exp', hashKey(CHAVE_EXPIRADA), 'ACTIVE', null, "now() - interval '1 day'"],
    ];

    for (const [id, hash, status, revogadaEm, expiraEm] of licencas) {
      await owner.$executeRawUnsafe(
        `INSERT INTO licenses (id, tenant_id, edition_id, key_hash, status,
                               customer_email, issued_at, updates_until, expires_at,
                               revoked_at, revoked_reason, created_at, updated_at)
         VALUES ($1, $2, 'aedi', $3, $4::"LicenseStatus", 'comprador@exemplo.com',
                 now(), now() + interval '12 months',
                 ${expiraEm ?? 'NULL'}, ${revogadaEm ?? 'NULL'},
                 ${revogadaEm ? `'reembolso'` : 'NULL'}, now(), now())
         ON CONFLICT (id) DO NOTHING`,
        id,
        TENANT,
        hash,
        status,
      );
    }
  }

  async function limpar() {
    await owner.$executeRawUnsafe(`DELETE FROM lic_events WHERE tenant_id = $1`, TENANT);
    await owner.$executeRawUnsafe(
      `DELETE FROM lic_activations WHERE tenant_id = $1`,
      TENANT,
    );
    await owner.$executeRawUnsafe(`DELETE FROM licenses WHERE tenant_id = $1`, TENANT);
    await owner.$executeRawUnsafe(`DELETE FROM lic_products WHERE tenant_id = $1`, TENANT);
    await owner.$executeRawUnsafe(`DELETE FROM tenants WHERE id = $1`, TENANT);
  }

  /** Linhas realmente gravadas — lidas pelo OWNER, fora do RLS. */
  async function ativacoesNoBanco() {
    return (await owner.$queryRawUnsafe(
      `SELECT id, fingerprint, hostname, deactivated_at FROM lic_activations
       WHERE license_id = 'alic' ORDER BY activated_at`,
    )) as Array<{ id: string; fingerprint: string; hostname: string | null }>;
  }

  it('ativa e GRAVA a linha (não é 200 com zero linhas)', async () => {
    // O teste que só o banco real dá: sem `runInTenantContext`, o `create` não
    // levantaria erro — gravaria zero linhas, e a rota devolveria um license
    // file válido para uma ativação que não existe.
    const file = await service.activate({
      key: CHAVE,
      fingerprint: 'fp-1',
      hostname: 'desktop',
    });

    expect(file.payload.fingerprint).toBe('fp-1');
    const gravadas = await ativacoesNoBanco();
    expect(gravadas).toHaveLength(1);
    expect(gravadas[0]).toMatchObject({ fingerprint: 'fp-1', hostname: 'desktop' });
  });

  it('o license file confere com a chave pública (critério de aceite)', async () => {
    const file = await service.activate({ key: CHAVE, fingerprint: 'fp-1' });
    expect(verifyLicenseFile(file, publicaPem)).toBe(true);
  });

  it('`updatesUntil` do arquivo é o da licença, e `issuedAt` é a emissão', async () => {
    // A emenda do PR-3: sem `issued_at` na `resolve_license`, o payload teria de
    // repetir outro campo — e o arquivo assinado diria uma data que não é a da
    // emissão.
    const file = await service.activate({ key: CHAVE, fingerprint: 'fp-1' });
    const [linha] = (await owner.$queryRawUnsafe(
      `SELECT issued_at, updates_until FROM licenses WHERE id = 'alic'`,
    )) as Array<{ issued_at: Date; updates_until: Date }>;

    expect(file.payload.issuedAt).toBe(linha.issued_at.toISOString());
    expect(file.payload.updatesUntil).toBe(linha.updates_until.toISOString());
    expect(file.payload.issuedAt).not.toBe(file.payload.updatesUntil);
  });

  it('reativar a MESMA máquina é idempotente e não consome vaga', async () => {
    await service.activate({ key: CHAVE, fingerprint: 'fp-1' });
    await service.activate({ key: CHAVE, fingerprint: 'fp-1' });
    await service.activate({ key: CHAVE, fingerprint: 'fp-1' });

    expect(await ativacoesNoBanco()).toHaveLength(1);

    // A 2ª máquina ainda cabe — a licença é de 2 e só uma vaga foi usada.
    await expect(
      service.activate({ key: CHAVE, fingerprint: 'fp-2' }),
    ).resolves.toBeDefined();
  });

  it('a 3ª máquina recebe 409 COM a lista de ativações', async () => {
    await service.activate({ key: CHAVE, fingerprint: 'fp-1', hostname: 'desktop' });
    await service.activate({ key: CHAVE, fingerprint: 'fp-2', hostname: 'notebook' });

    // Sem a lista, o comprador vê "limite atingido" e não tem como saber qual
    // desativar. A troca self-service é a SPEC-037, mas a informação que a
    // torna possível nasce aqui.
    await expect(
      service.activate({ key: CHAVE, fingerprint: 'fp-3' }),
    ).rejects.toMatchObject({
      status: 409,
      response: {
        activations: expect.arrayContaining([
          expect.objectContaining({ hostname: 'notebook' }),
          expect.objectContaining({ hostname: 'desktop' }),
        ]),
      },
    });
  });

  it('chave inexistente → 404', async () => {
    await expect(
      service.activate({ key: 'WR-ZZ23-ZZ45-ZZ67-ZZ89', fingerprint: 'fp-1' }),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('licença revogada → 410', async () => {
    await expect(
      service.activate({ key: CHAVE_REVOGADA, fingerprint: 'fp-1' }),
    ).rejects.toMatchObject({ status: 410 });
  });

  it('licença expirada → 410', async () => {
    await expect(
      service.activate({ key: CHAVE_EXPIRADA, fingerprint: 'fp-1' }),
    ).rejects.toMatchObject({ status: 410 });
  });

  it('revogada não grava ativação nem evento', async () => {
    // O 410 tem de acontecer ANTES de qualquer escrita: uma linha gravada aqui
    // seria uma ativação de licença morta, visível no painel.
    await expect(
      service.activate({ key: CHAVE_REVOGADA, fingerprint: 'fp-1' }),
    ).rejects.toThrow();

    const linhas = (await owner.$queryRawUnsafe(
      `SELECT id FROM lic_activations WHERE license_id = 'alic-rev'`,
    )) as unknown[];
    expect(linhas).toHaveLength(0);
  });

  it('a chave digitada em minúscula ativa a mesma licença', async () => {
    // O modo de falhar mais caro: a mesma chave com outra caixa daria 404 numa
    // licença que existe — e parece erro do comprador.
    await expect(
      service.activate({ key: CHAVE.toLowerCase(), fingerprint: 'fp-1' }),
    ).resolves.toBeDefined();
    expect(await ativacoesNoBanco()).toHaveLength(1);
  });

  it('registra `activated` e depois `reactivated` na trilha', async () => {
    await service.activate({ key: CHAVE, fingerprint: 'fp-1' });
    await service.activate({ key: CHAVE, fingerprint: 'fp-1' });

    const eventos = (await owner.$queryRawUnsafe(
      `SELECT type FROM lic_events WHERE license_id = 'alic' ORDER BY created_at`,
    )) as Array<{ type: string }>;
    expect(eventos.map((e) => e.type)).toEqual(['activated', 'reactivated']);
  });

  it('a trilha não guarda a chave em claro', async () => {
    // O `payload` do evento é lido no painel — vazá-la ali seria vazamento com
    // tela.
    await service.activate({ key: CHAVE, fingerprint: 'fp-1' });
    const [linha] = (await owner.$queryRawUnsafe(
      `SELECT payload::text AS p FROM lic_events WHERE license_id = 'alic'`,
    )) as Array<{ p: string }>;
    expect(linha.p).not.toContain('AB23');
  });

  it.each([
    ['sem chave', { fingerprint: 'fp-1' }],
    ['sem fingerprint', { key: CHAVE }],
    ['fingerprint vazio', { key: CHAVE, fingerprint: '   ' }],
    ['chave não-string', { key: 42, fingerprint: 'fp-1' }],
  ])('recusa %s com 422', async (_caso, entrada) => {
    await expect(service.activate(entrada)).rejects.toMatchObject({ status: 422 });
  });

  it('`hostname` longo demais é truncado, não recusado', async () => {
    // Campo de exibição vindo de máquina alheia: cortar é melhor que falhar a
    // ativação de quem pagou por causa de um nome de host esquisito.
    await service.activate({
      key: CHAVE,
      fingerprint: 'fp-1',
      hostname: 'h'.repeat(500),
    });
    const [linha] = await ativacoesNoBanco();
    expect(linha.hostname).toHaveLength(128);
  });
});
