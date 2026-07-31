/**
 * `releases/check` (PR-2) e `releases/download` (PR-3) contra Postgres REAL.
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
 *
 * ## O que o PR-3 acrescenta, e por que também aqui
 *
 * O `download` toca **duas tabelas a mais sob RLS** (`lic_settings` para o PAT,
 * `lic_events` para a trilha) e o mock não prova nenhuma das duas:
 *
 * - **`Tenant B não baixa asset com o PAT do tenant A`** é critério de aceite
 *   explícito. A leitura do PAT é por `tenantId` e cada tenant tem o seu — se a
 *   consulta esquecer o filtro, ou o contexto de tenant não valer, o download de
 *   um tenant sairia autenticado com a credencial do outro. Nenhum erro
 *   apareceria: o GitHub responderia normalmente, com o token errado.
 * - **O `LicEvent` grava sob RLS.** Fora do contexto o `create` falha ou some
 *   (fail-closed), e a trilha de *"quem levou o quê"* ficaria vazia sem que
 *   nada quebrasse — o download continuaria funcionando.
 *
 * O GitHub em si é dobrado (não se testa a rede aqui). O que **não** é dobrado é
 * nada do banco.
 */
import { PrismaClient } from '@prisma/client';
import { generateKeyPairSync } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { ownerClient, applyMigrations, grantAppRole } from '../../../test/int/db-harness';
import { CryptoService } from '../identity/infrastructure/crypto.service';
import type { GithubSourceClient } from './infrastructure/github-source.client';
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

/** Os PATs de cada tenant, em claro. O teste do isolamento compara por eles. */
const PAT_A = 'github_pat_do_tenant_A';
const PAT_B = 'github_pat_do_tenant_B';

describe('SPEC-041 PR-2/PR-3: releases contra Postgres real', () => {
  let owner: PrismaClient;
  let prisma: PrismaService;
  let releases: LicenseReleaseService;
  /** O que o cliente do GitHub recebeu na última chamada — PAT, repo, asset. */
  let ultimaChamada: { pat: string; repo: string; assetId: string } | null;
  let github: GithubSourceClient;

  beforeAll(async () => {
    applyMigrations();
    owner = ownerClient();
    await grantAppRole(owner);

    const { privateKey } = generateKeyPairSync('ed25519');
    process.env.LICENSING_SIGNING_KEY = privateKey
      .export({ type: 'pkcs8', format: 'pem' })
      .toString();
    process.env.LICENSING_SIGNING_KID = '2026-07';
    // 32 bytes em hex — o `CryptoService` real cifra o PAT com esta chave, e é o
    // mesmo caminho da SPEC-039. Cifrar de verdade importa: um valor plantado em
    // claro na coluna passaria no mock e falharia em produção.
    process.env.TOKEN_ENCRYPTION_KEY = 'f'.repeat(64);

    process.env.DATABASE_URL =
      process.env.TEST_DATABASE_URL ??
      'postgresql://proplan_app:proplan_app@localhost:5433/proplan_test';
    prisma = new PrismaService();

    // O GitHub é o único dobrado — a rede não é o que se testa aqui. Ele registra
    // com QUE credencial foi chamado, que é o objeto do teste de isolamento.
    github = {
      assetDownloadUrl: async (pat: string, repo: string, assetId: string) => {
        ultimaChamada = { pat, repo, assetId };
        return `https://storage.example/${assetId}?sig=fresco-${Math.random()}`;
      },
    } as unknown as GithubSourceClient;

    releases = new LicenseReleaseService(
      prisma,
      new LicenseActivationService(prisma, new LicenseSigningService()),
      github,
      new CryptoService(),
    );

    await semear();
  });

  beforeEach(() => {
    ultimaChamada = null;
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

  describe('download (PR-3)', () => {
    const PEDIDO = {
      licenseKey: CHAVE_EM_DIA,
      fingerprint: FP,
      version: '1.1.0',
      os: 'win-x64',
    };

    it('licença em dia baixa a versão corrente e a URL vem com o sha256 registrado', async () => {
      const r = await releases.download({ ...PEDIDO, version: '2.0.0' });

      expect(r.url).toContain('https://storage.example/');
      // O `sha256` sai do banco, não do pedido: é o que a máquina do cliente
      // confere DEPOIS de baixar. Se viesse do corpo, o cliente confirmaria o
      // arquivo contra o hash que ele mesmo mandou.
      expect(r.sha256).toBe('a'.repeat(64));
      expect(r.expiresInSeconds).toBeGreaterThan(0);
    });

    it('licença com janela VENCIDA baixa a última autorizada', async () => {
      // É o critério da licença perpétua do outro lado: o `check` já disse
      // `1.1.0`; aqui o download dela precisa funcionar de fato — senão a
      // promessa vale só na resposta e não no arquivo.
      const r = await releases.download({ ...PEDIDO, licenseKey: CHAVE_VENCIDA });

      expect(r.sha256).toBe('a'.repeat(64));
      expect(ultimaChamada?.assetId).toBe('asset-1');
    });

    it('licença com janela vencida NÃO baixa a versão de depois — 403', async () => {
      await expect(
        releases.download({ ...PEDIDO, licenseKey: CHAVE_VENCIDA, version: '2.0.0' }),
      ).rejects.toMatchObject({ status: 403 });
    });

    it('dois downloads seguidos devolvem URLs DIFERENTES', async () => {
      // §Critérios de aceite — prova de que a URL assinada não é cacheada. Ela
      // expira em segundos; servir a mesma duas vezes entregaria ao segundo
      // cliente um link já morto, que ele leria como "download não começa".
      const a = await releases.download(PEDIDO);
      const b = await releases.download(PEDIDO);

      expect(a.url).not.toBe(b.url);
    });

    it('release despublicada some do download — 404, não 403', async () => {
      await owner.$executeRawUnsafe(
        `UPDATE lic_releases SET published = false WHERE id = 'rlrel-110'`,
      );

      // `404` e não `403`: quem despublicou por defeito não deve informar a quem
      // pergunta que a versão existe.
      await expect(releases.download(PEDIDO)).rejects.toMatchObject({ status: 404 });

      await owner.$executeRawUnsafe(
        `UPDATE lic_releases SET published = true WHERE id = 'rlrel-110'`,
      );
    });

    it('plataforma inexistente responde 404, mesmo com a versão certa', async () => {
      // `(version, os)` juntos, não só a versão: sem o `os`, `1.1.0` casaria com
      // o artefato de outra plataforma e o cliente baixaria o binário errado —
      // que só falharia ao executar.
      await expect(
        releases.download({ ...PEDIDO, os: 'linux-x64' }),
      ).rejects.toMatchObject({ status: 404 });
    });

    it('TENANT B não baixa com o PAT do TENANT A', async () => {
      // **Critério de aceite explícito da emenda.** A leitura do PAT é por
      // `tenantId` e cada tenant tem o seu — sem o filtro, ou com o contexto de
      // tenant errado, o download de um sairia autenticado com a credencial do
      // outro. E nada apareceria: o GitHub responderia normalmente, com o token
      // errado.
      await releases.download({ ...PEDIDO, version: '2.0.0' });
      expect(ultimaChamada).toMatchObject({ pat: PAT_A, repo: 'RodReis/war-room' });

      await releases.download({
        licenseKey: CHAVE_ALHEIA,
        fingerprint: FP,
        version: '3.0.0',
        os: 'win-x64',
      });
      expect(ultimaChamada).toMatchObject({ pat: PAT_B, repo: 'outro/produto' });
    });

    it('a release de OUTRO tenant não é alcançável por chave deste', async () => {
      // A `3.0.0` existe — no outro tenant. O `productId` vem da licença e a
      // busca roda sob RLS; se qualquer um dos dois falhar, esta licença baixaria
      // o instalador de um produto que não comprou.
      await expect(
        releases.download({ ...PEDIDO, version: '3.0.0' }),
      ).rejects.toMatchObject({ status: 404 });
    });

    it('cada download autorizado grava um LicEvent — e ele grava sob RLS', async () => {
      const antes = await contarEventos();
      await releases.download({ ...PEDIDO, version: '2.0.0' });
      const depois = await contarEventos();

      // Fora do contexto de tenant o `create` falharia ou sumiria (fail-closed),
      // e a trilha de *quem levou o quê* ficaria vazia sem nada quebrar — o
      // download continuaria respondendo normalmente.
      expect(depois).toBe(antes + 1);

      const [evento] = await owner.$queryRawUnsafe<Array<{ type: string; payload: unknown }>>(
        `SELECT type, payload FROM lic_events WHERE license_id = 'rllic-emdia'
         ORDER BY created_at DESC LIMIT 1`,
      );
      expect(evento.type).toBe('release_downloaded');
      // A URL NÃO entra no payload: ela morre em segundos e guardá-la encheria a
      // trilha de segredo de vida curta.
      expect(evento.payload).toEqual({
        version: '2.0.0',
        os: 'win-x64',
        releaseId: 'rlrel-200',
      });
      expect(JSON.stringify(evento.payload)).not.toContain('storage.example');
    });

    it('download recusado por autorização NÃO grava evento', async () => {
      const antes = await contarEventos();

      await expect(
        releases.download({ ...PEDIDO, licenseKey: CHAVE_VENCIDA, version: '2.0.0' }),
      ).rejects.toMatchObject({ status: 403 });

      // A trilha responde *quem levou o quê*. Registrar a recusa a faria mentir
      // exatamente sobre a pergunta que existe para responder.
      expect(await contarEventos()).toBe(antes);
    });

    it('tenant sem PAT responde 503 com motivo, nunca 500', async () => {
      await owner.$executeRawUnsafe(
        `UPDATE lic_settings SET github_pat = NULL WHERE tenant_id = $1`,
        TENANT,
      );

      // §Critérios de aceite: erro de configuração explícito. O modo de errar
      // aqui é mudo por natureza — a máquina do cliente para de receber update e
      // ninguém no admin fica sabendo —, então o mínimo é que o erro diga o que é.
      await expect(releases.download(PEDIDO)).rejects.toMatchObject({ status: 503 });

      await owner.$executeRawUnsafe(
        `UPDATE lic_settings SET github_pat = $2 WHERE tenant_id = $1`,
        TENANT,
        new CryptoService().encrypt(PAT_A),
      );
    });

    it('chave inexistente, fingerprint inativo e revogada respondem igual ao check', async () => {
      // O gate é literalmente o mesmo método — o teste existe para provar que a
      // rota nova não nasceu com uma segunda opinião.
      await expect(
        releases.download({ ...PEDIDO, licenseKey: 'WR-ZZZZ-ZZZZ-ZZZZ-ZZZZ' }),
      ).rejects.toMatchObject({ status: 404 });

      await expect(
        releases.download({ ...PEDIDO, fingerprint: 'fp-nunca-ativado' }),
      ).rejects.toMatchObject({ status: 409 });

      await owner.$executeRawUnsafe(
        `UPDATE licenses SET status = 'REVOKED', revoked_at = now() WHERE id = 'rllic-emdia'`,
      );
      await expect(releases.download(PEDIDO)).rejects.toMatchObject({ status: 410 });
      await owner.$executeRawUnsafe(
        `UPDATE licenses SET status = 'ACTIVE', revoked_at = NULL WHERE id = 'rllic-emdia'`,
      );
    });

    async function contarEventos(): Promise<number> {
      const [linha] = await owner.$queryRawUnsafe<Array<{ n: bigint }>>(
        `SELECT count(*) AS n FROM lic_events WHERE tenant_id = ANY($1)`,
        [TENANT, OUTRO_TENANT],
      );
      return Number(linha.n);
    }
  });

  async function semear() {
    const crypto = new CryptoService();

    const tenants: Array<[string, string, string, string, string, string, string, string]> = [
      [TENANT, 'a', 'rlprod-a', 'rledi-a', 'warroom', 'WR', 'RodReis/war-room', PAT_A],
      [OUTRO_TENANT, 'b', 'rlprod-b', 'rledi-b', 'outro', 'OT', 'outro/produto', PAT_B],
    ];

    for (const [
      tenant,
      sufixo,
      produto,
      edicao,
      slug,
      prefixo,
      repo,
      pat,
    ] of tenants) {
      await owner.$executeRawUnsafe(
        `INSERT INTO tenants (id, installation_id, account_login, account_type, created_at)
         VALUES ($1, NULL, $2, 'User', now()) ON CONFLICT (id) DO NOTHING`,
        tenant,
        `rl-${sufixo}`,
      );
      await owner.$executeRawUnsafe(
        `INSERT INTO lic_products (id, tenant_id, slug, name, key_prefix, source_repo,
                                   created_at, updated_at)
         VALUES ($1, $2, $3, 'Produto', $4, $5, now(), now())
         ON CONFLICT (id) DO NOTHING`,
        produto,
        tenant,
        slug,
        prefixo,
        repo,
      );
      // O PAT **cifrado**, pelo mesmo `CryptoService` que o service usa para
      // abrir. Cada tenant tem o seu — é o par que o teste de isolamento compara.
      await owner.$executeRawUnsafe(
        `INSERT INTO lic_settings (id, tenant_id, github_pat, created_at, updated_at)
         VALUES ($1, $2, $3, now(), now()) ON CONFLICT (tenant_id) DO NOTHING`,
        `rlset-${sufixo}`,
        tenant,
        crypto.encrypt(pat),
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
    await owner.$executeRawUnsafe(`DELETE FROM lic_settings WHERE tenant_id = ANY($1)`, ids);
    await owner.$executeRawUnsafe(`DELETE FROM lic_editions WHERE id = ANY($1)`, [
      'rledi-a',
      'rledi-b',
    ]);
    await owner.$executeRawUnsafe(`DELETE FROM lic_products WHERE tenant_id = ANY($1)`, ids);
    await owner.$executeRawUnsafe(`DELETE FROM tenants WHERE id = ANY($1)`, ids);
  }
});
