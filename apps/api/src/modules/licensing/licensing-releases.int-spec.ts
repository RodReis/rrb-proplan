/**
 * `releases/check` (SPEC-041, PR-2) contra Postgres REAL.
 *
 * **Por que int-spec, e não mock.** A rota depende de três coisas que só existem
 * no banco, e um mock afirmaria cada uma sem provar nenhuma:
 *
 * 1. **A `resolve_license` tem de devolver `product_id`.** Sem ele não há por
 *    onde começar a busca de releases. É o irmão exato do defeito que a SPEC-038
 *    (PR-4) fechou com `past_due_at`: a coluna existe, o código a lê, e a função
 *    não a devolve — o gate roda com `undefined` e a resposta vira *"nenhuma
 *    atualização"* para toda licença válida, **sem erro em log nenhum**.
 * 2. **A função é `SECURITY DEFINER` e o `DROP` da migration leva os privilégios
 *    junto.** Se o `GRANT EXECUTE` faltar, toda ativação — e todo check — falha
 *    por permissão. O harness roda com a role `proplan_app` justamente para que
 *    esquecer isso quebre aqui, não em produção.
 * 3. **A busca roda sob RLS**, dentro de `runInTenantContext`. Fora do contexto o
 *    `findMany` devolve zero linhas **sem erro** (fail-closed), e o sintoma seria
 *    o mesmo do item 1 — a falha muda que os critérios de aceite perseguem.
 *
 * O caso que mais interessa é a **licença com janela vencida**: ela deve receber
 * a última versão autorizada, não a corrente e não `update: false`. É o critério
 * que prova a promessa da licença perpétua.
 */
import { PrismaClient } from '@prisma/client';
import { generateKeyPairSync } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { ownerClient, applyMigrations, grantAppRole } from '../../../test/int/db-harness';
import { LicenseActivationService } from './application/license-activation.service';
import { LicenseReleaseService } from './application/license-release.service';
import { LicenseSigningService } from './application/license-signing.service';
import { hashKey } from './domain/license-key';

const TENANT = '00000000-0000-4000-8000-11fecd110051';
const OUTRO_TENANT = '00000000-0000-4000-8000-11fecd110052';

/** Janela de updates até 2027 — alcança todas as releases semeadas. */
const CHAVE_EM_DIA = 'WR-RL01-CD45-EF67-GH89';
/** Janela vencida em 2026-06-30 — alcança só até a `1.1.0`. */
const CHAVE_VENCIDA = 'WR-RL02-CD45-EF67-GH89';
/** Licença de OUTRO tenant, outro produto. Prova o isolamento. */
const CHAVE_ALHEIA = 'WR-RL03-CD45-EF67-GH89';

const FP = 'fp-release-1';

describe('SPEC-041 PR-2: releases/check contra Postgres real', () => {
  let owner: PrismaClient;
  let prisma: PrismaService;
  let releases: LicenseReleaseService;

  beforeAll(async () => {
    applyMigrations();
    owner = ownerClient();
    await grantAppRole(owner);

    const { privateKey } = generateKeyPairSync('ed25519');
    process.env.LICENSING_SIGNING_KEY = privateKey
      .export({ type: 'pkcs8', format: 'pem' })
      .toString();
    process.env.LICENSING_SIGNING_KID = '2026-07';

    process.env.DATABASE_URL =
      process.env.TEST_DATABASE_URL ??
      'postgresql://proplan_app:proplan_app@localhost:5433/proplan_test';
    prisma = new PrismaService();
    releases = new LicenseReleaseService(
      prisma,
      new LicenseActivationService(prisma, new LicenseSigningService()),
    );

    await semear();
  });

  afterAll(async () => {
    await limpar();
    await owner.$disconnect();
    await (prisma as unknown as PrismaClient).$disconnect();
  });

  it('licença em dia recebe a release corrente', async () => {
    const r = await releases.check({ licenseKey: CHAVE_EM_DIA, fingerprint: FP });

    expect(r).toMatchObject({ update: true, version: '2.0.0', reason: 'current' });
  });

  it('licença com janela VENCIDA recebe a última autorizada, não a corrente', async () => {
    // **O critério que prova a promessa da licença perpétua.** Quem parou de
    // pagar update continua baixando o que já tinha direito. Se este teste
    // passar a devolver `2.0.0`, estamos dando de graça o que não foi comprado;
    // se passar a devolver `update: false`, estamos tirando o que já era dele.
    const r = await releases.check({ licenseKey: CHAVE_VENCIDA, fingerprint: FP });

    expect(r).toMatchObject({
      update: true,
      version: '1.1.0',
      reason: 'last-authorized',
    });
  });

  it('release despublicada some do check', async () => {
    await owner.$executeRawUnsafe(
      `UPDATE lic_releases SET published = false WHERE id = 'rlrel-200'`,
    );

    // Sem a `2.0.0` publicada, a licença em dia cai para a `1.1.0` — e como agora
    // ela É a mais nova visível, o motivo passa a ser `current`.
    const r = await releases.check({ licenseKey: CHAVE_EM_DIA, fingerprint: FP });
    expect(r).toMatchObject({ update: true, version: '1.1.0', reason: 'current' });

    await owner.$executeRawUnsafe(
      `UPDATE lic_releases SET published = true WHERE id = 'rlrel-200'`,
    );
  });

  it('cliente já na versão corrente recebe update: false', async () => {
    const r = await releases.check({
      licenseKey: CHAVE_EM_DIA,
      fingerprint: FP,
      currentVersion: '2.0.0',
    });

    expect(r).toEqual({ update: false });
  });

  it('a release de OUTRO tenant nunca aparece', async () => {
    // O `product_id` vem da licença, e a busca roda sob RLS no tenant dono. Se
    // qualquer um dos dois falhar, esta licença veria a `9.9.9` do outro tenant —
    // e o cliente baixaria o instalador de um produto que não comprou.
    const r = await releases.check({ licenseKey: CHAVE_ALHEIA, fingerprint: FP });

    expect(r).toMatchObject({ update: true, version: '3.0.0' });
  });

  it('chave inexistente responde 404', async () => {
    await expect(
      releases.check({ licenseKey: 'WR-ZZZZ-ZZZZ-ZZZZ-ZZZZ', fingerprint: FP }),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('fingerprint não ativo responde 409, sem reativar em silêncio', async () => {
    // Mesma regra do `heartbeat`: sem ela bastaria pular o `/activate` e pedir
    // update para furar o `maxMachines` — a máquina não ativada receberia binário
    // novo sem nunca ter ocupado uma vaga.
    await expect(
      releases.check({ licenseKey: CHAVE_EM_DIA, fingerprint: 'fp-nunca-ativado' }),
    ).rejects.toMatchObject({ status: 409 });
  });

  it('licença revogada responde 410', async () => {
    // `revoked_at` junto: o CHECK `licenses_revoked_coherent` recusa `REVOKED`
    // sem data. A guarda existe para impedir uma revogada que não sabe dizer
    // quando foi revogada — e é a mesma classe de erro do FIX #216, onde o
    // `update` incompleto batia no CHECK e virava `500` na tela.
    await owner.$executeRawUnsafe(
      `UPDATE licenses SET status = 'REVOKED', revoked_at = now() WHERE id = 'rllic-emdia'`,
    );

    // O reembolsado não pode continuar recebendo versões novas — é o gate
    // compartilhado com `/activate` fazendo efeito aqui.
    await expect(
      releases.check({ licenseKey: CHAVE_EM_DIA, fingerprint: FP }),
    ).rejects.toMatchObject({ status: 410 });

    await owner.$executeRawUnsafe(
      `UPDATE licenses SET status = 'ACTIVE', revoked_at = NULL WHERE id = 'rllic-emdia'`,
    );
  });

  async function semear() {
    const tenants: Array<[string, string, string, string, string, string]> = [
      [TENANT, 'a', 'rlprod-a', 'rledi-a', 'warroom', 'WR'],
      [OUTRO_TENANT, 'b', 'rlprod-b', 'rledi-b', 'outro', 'OT'],
    ];

    for (const [tenant, sufixo, produto, edicao, slug, prefixo] of tenants) {
      await owner.$executeRawUnsafe(
        `INSERT INTO tenants (id, installation_id, account_login, account_type, created_at)
         VALUES ($1, NULL, $2, 'User', now()) ON CONFLICT (id) DO NOTHING`,
        tenant,
        `rl-${sufixo}`,
      );
      await owner.$executeRawUnsafe(
        `INSERT INTO lic_products (id, tenant_id, slug, name, key_prefix, created_at, updated_at)
         VALUES ($1, $2, $3, 'Produto', $4, now(), now())
         ON CONFLICT (id) DO NOTHING`,
        produto,
        tenant,
        slug,
        prefixo,
      );
      await owner.$executeRawUnsafe(
        `INSERT INTO lic_editions (id, product_id, slug, name, billing_model,
                                   max_machines, updates_months, created_at, updated_at)
         VALUES ($1, $2, 'source', 'Com código-fonte', 'PERPETUAL', 2, 12, now(), now())
         ON CONFLICT (id) DO NOTHING`,
        edicao,
        produto,
      );
    }

    // Três releases do produto A, e uma do produto B com versão bem maior — se o
    // isolamento falhar, a `9.9.9` aparece para quem não a comprou.
    const rels: Array<[string, string, string, string, string]> = [
      ['rlrel-100', 'rlprod-a', TENANT, '1.0.0', '2026-01-10'],
      ['rlrel-110', 'rlprod-a', TENANT, '1.1.0', '2026-03-01'],
      ['rlrel-200', 'rlprod-a', TENANT, '2.0.0', '2026-09-01'],
      ['rlrel-300', 'rlprod-b', OUTRO_TENANT, '3.0.0', '2026-02-01'],
      ['rlrel-999', 'rlprod-b', OUTRO_TENANT, '9.9.9', '2027-01-01'],
    ];

    for (const [id, produto, tenant, versao, data] of rels) {
      await owner.$executeRawUnsafe(
        `INSERT INTO lic_releases (id, tenant_id, product_id, version, os, released_at,
                                   asset_id, sha256, notes, published, created_at, updated_at)
         VALUES ($1, $2, $3, $4, 'win-x64', $5::timestamp, 'asset-1', $6, NULL, true, now(), now())
         ON CONFLICT (id) DO NOTHING`,
        id,
        tenant,
        produto,
        versao,
        data,
        'a'.repeat(64),
      );
    }

    // `updates_until` é o dado central desta suíte: 2027 alcança tudo; 2026-06-30
    // para na `1.1.0`. A licença alheia existe para provar o isolamento.
    const licencas: Array<[string, string, string, string, string]> = [
      ['rllic-emdia', TENANT, 'rledi-a', CHAVE_EM_DIA, '2027-12-31'],
      ['rllic-vencida', TENANT, 'rledi-a', CHAVE_VENCIDA, '2026-06-30'],
      ['rllic-alheia', OUTRO_TENANT, 'rledi-b', CHAVE_ALHEIA, '2026-06-30'],
    ];

    for (const [id, tenant, edicao, chave, updatesUntil] of licencas) {
      await owner.$executeRawUnsafe(
        `INSERT INTO licenses (id, tenant_id, edition_id, key_hash, status,
                               customer_email, issued_at, updates_until,
                               expires_at, past_due_at, created_at, updated_at)
         VALUES ($1, $2, $3, $4, 'ACTIVE', 'comprador@exemplo.com', now(),
                 $5::timestamp, NULL, NULL, now(), now())
         ON CONFLICT (id) DO NOTHING`,
        id,
        tenant,
        edicao,
        hashKey(chave),
        updatesUntil,
      );

      // A máquina precisa estar ATIVA: o check exige fingerprint ativo, mesma
      // regra do heartbeat.
      await owner.$executeRawUnsafe(
        `INSERT INTO lic_activations (id, tenant_id, license_id, fingerprint,
                                      activated_at, last_seen_at)
         VALUES ($1, $2, $3, $4, now(), now())
         ON CONFLICT (id) DO NOTHING`,
        `rlact-${id}`,
        tenant,
        id,
        FP,
      );
    }
  }

  async function limpar() {
    const ids = [TENANT, OUTRO_TENANT];
    await owner.$executeRawUnsafe(`DELETE FROM lic_events WHERE tenant_id = ANY($1)`, ids);
    await owner.$executeRawUnsafe(
      `DELETE FROM lic_activations WHERE tenant_id = ANY($1)`,
      ids,
    );
    await owner.$executeRawUnsafe(`DELETE FROM licenses WHERE tenant_id = ANY($1)`, ids);
    await owner.$executeRawUnsafe(`DELETE FROM lic_releases WHERE tenant_id = ANY($1)`, ids);
    await owner.$executeRawUnsafe(`DELETE FROM lic_editions WHERE id = ANY($1)`, [
      'rledi-a',
      'rledi-b',
    ]);
    await owner.$executeRawUnsafe(`DELETE FROM lic_products WHERE tenant_id = ANY($1)`, ids);
    await owner.$executeRawUnsafe(`DELETE FROM tenants WHERE id = ANY($1)`, ids);
  }
});
