/**
 * Heartbeat, desativação e troca de máquina (SPEC-037) contra Postgres REAL.
 *
 * **Por que int-spec.** Esta fatia inteira é sobre *contagem de vagas* — e vaga
 * é uma propriedade do conjunto de linhas, não de uma linha. Um mock do Prisma
 * "conta" o que o teste mandou ele contar; aqui a contagem é a de verdade, com
 * o unique `(license_id, fingerprint)` e o `deactivatedAt` no meio.
 *
 * Os quatro modos de errar que só aparecem assim:
 *
 * 1. **Fail-closed.** Sem `runInTenantContext`, o `update` do heartbeat grava
 *    ZERO LINHAS sem erro — o cliente receberia um arquivo reassinado e o
 *    `lastSeenAt` ficaria parado, até a máquina cair em degradado sozinha.
 * 2. **Reativar furando o limite.** Uma linha desativada que volta pelo ramo
 *    "já existe" não passaria pela contagem, e desativar/reativar em ciclo
 *    tornaria o `maxMachines` decorativo.
 * 3. **Heartbeat reativando em silêncio.** Se o fingerprint desativado
 *    revivesse aqui, bastaria pular o `/activate` para nunca bater no limite.
 * 4. **Evento duplicado na idempotência.** Um `deactivated` a mais por retry de
 *    rede infla o contador de trocas e faz o sinal de abuso disparar sozinho.
 */
import { PrismaClient } from '@prisma/client';
import { generateKeyPairSync } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { ownerClient, applyMigrations, grantAppRole } from '../../../test/int/db-harness';
import { LicenseActivationService } from './application/license-activation.service';
import { LicenseAdminService } from './application/license-admin.service';
import { LicenseSigningService } from './application/license-signing.service';
import { hashKey } from './domain/license-key';
import { verifyLicenseFile } from './domain/license-file';

const TENANT = '00000000-0000-4000-8000-11fec1c10001';
const OUTRO_TENANT = '00000000-0000-4000-8000-11fec1c10002';
const CHAVE = 'WR-LF23-CD45-EF67-GH89';
const CHAVE_OUTRA = 'WR-LF99-CD45-EF67-GH89';
const CHAVE_REVOGADA = 'WR-LFRV-CD45-EF67-GH89';

describe('SPEC-037: heartbeat, desativação e troca de máquina', () => {
  let owner: PrismaClient;
  let prisma: PrismaService;
  let service: LicenseActivationService;
  let admin: LicenseAdminService;
  let publicaPem: string;

  beforeAll(async () => {
    applyMigrations();
    owner = ownerClient();
    await grantAppRole(owner);

    const { privateKey, publicKey } = generateKeyPairSync('ed25519');
    process.env.LICENSING_SIGNING_KEY = privateKey
      .export({ type: 'pkcs8', format: 'pem' })
      .toString();
    process.env.LICENSING_SIGNING_KID = '2026-07';
    publicaPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();

    // Reaponta ANTES de instanciar: o `PrismaService` chama `super()` sem
    // `datasources` e lê `DATABASE_URL`, que no `.env` aponta para o banco de
    // DEV. Sem isto o seed grava num banco e o service consulta outro.
    process.env.DATABASE_URL =
      process.env.TEST_DATABASE_URL ??
      'postgresql://proplan_app:proplan_app@localhost:5433/proplan_test';
    prisma = new PrismaService();
    service = new LicenseActivationService(prisma, new LicenseSigningService());
    admin = new LicenseAdminService(prisma);

    await semear();
  });

  afterAll(async () => {
    await limpar();
    await owner.$disconnect();
    await (prisma as unknown as PrismaClient).$disconnect();
  });

  beforeEach(async () => {
    // Cada teste começa sem máquina: a contagem de vagas é o que quase todos
    // exercem, e um resíduo do anterior falsearia o resultado.
    await owner.$executeRawUnsafe(
      `DELETE FROM lic_activations WHERE tenant_id = ANY($1)`,
      [TENANT, OUTRO_TENANT],
    );
    await owner.$executeRawUnsafe(`DELETE FROM lic_events WHERE tenant_id = ANY($1)`, [
      TENANT,
      OUTRO_TENANT,
    ]);
  });

  async function semear() {
    for (const [tenant, sufixo] of [
      [TENANT, 'a'],
      [OUTRO_TENANT, 'b'],
    ] as const) {
      await owner.$executeRawUnsafe(
        `INSERT INTO tenants (id, installation_id, account_login, account_type, created_at)
         VALUES ($1, NULL, $2, 'User', now()) ON CONFLICT (id) DO NOTHING`,
        tenant,
        `lf-${sufixo}`,
      );
      await owner.$executeRawUnsafe(
        `INSERT INTO lic_products (id, tenant_id, slug, name, key_prefix, created_at, updated_at)
         VALUES ($1, $2, 'warroom', 'War Room', 'WR', now(), now())
         ON CONFLICT (id) DO NOTHING`,
        `lfprod-${sufixo}`,
        tenant,
      );
      await owner.$executeRawUnsafe(
        `INSERT INTO lic_editions (id, product_id, slug, name, billing_model,
                                   max_machines, updates_months, created_at, updated_at)
         VALUES ($1, $2, 'closed', 'Sem código-fonte', 'PERPETUAL', 2, 12, now(), now())
         ON CONFLICT (id) DO NOTHING`,
        `lfedi-${sufixo}`,
        `lfprod-${sufixo}`,
      );
    }

    const licencas: Array<[string, string, string, string, string | null]> = [
      ['lflic', TENANT, 'lfedi-a', hashKey(CHAVE), null],
      ['lflic-b', OUTRO_TENANT, 'lfedi-b', hashKey(CHAVE_OUTRA), null],
      ['lflic-rev', TENANT, 'lfedi-a', hashKey(CHAVE_REVOGADA), 'now()'],
    ];

    for (const [id, tenant, edicao, hash, revogadaEm] of licencas) {
      await owner.$executeRawUnsafe(
        `INSERT INTO licenses (id, tenant_id, edition_id, key_hash, status,
                               customer_email, issued_at, updates_until,
                               revoked_at, revoked_reason, created_at, updated_at)
         VALUES ($1, $2, $3, $4, ${revogadaEm ? `'REVOKED'` : `'ACTIVE'`},
                 'comprador@exemplo.com', now(), now() + interval '12 months',
                 ${revogadaEm ?? 'NULL'}, ${revogadaEm ? `'reembolso'` : 'NULL'},
                 now(), now())
         ON CONFLICT (id) DO NOTHING`,
        id,
        tenant,
        edicao,
        hash,
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
    await owner.$executeRawUnsafe(`DELETE FROM lic_products WHERE tenant_id = ANY($1)`, ids);
    await owner.$executeRawUnsafe(`DELETE FROM tenants WHERE id = ANY($1)`, ids);
  }

  /** Lido pelo OWNER, fora do RLS — o que está no banco de verdade. */
  async function ativacoes(licenseId = 'lflic') {
    return (await owner.$queryRawUnsafe(
      `SELECT id, fingerprint, hostname, app_version, last_seen_at, deactivated_at
       FROM lic_activations WHERE license_id = $1 ORDER BY activated_at`,
      licenseId,
    )) as Array<{
      id: string;
      fingerprint: string;
      hostname: string | null;
      app_version: string | null;
      last_seen_at: Date;
      deactivated_at: Date | null;
    }>;
  }

  async function eventos(licenseId = 'lflic') {
    const linhas = (await owner.$queryRawUnsafe(
      `SELECT type FROM lic_events WHERE license_id = $1 ORDER BY created_at`,
      licenseId,
    )) as Array<{ type: string }>;
    return linhas.map((l) => l.type);
  }

  describe('heartbeat', () => {
    it('reassina com `signedAt` mais recente e atualiza `lastSeenAt`', async () => {
      // O critério central: é o `signedAt` novo que reinicia a graça de 14 dias
      // no cliente. Sem ele o arquivo envelhece e a máquina cai em degradado
      // mesmo com a licença viva.
      const ativacao = await service.activate({ key: CHAVE, fingerprint: 'fp-1' });
      const [antes] = await ativacoes();

      const batida = await service.heartbeat({ key: CHAVE, fingerprint: 'fp-1' });
      const [depois] = await ativacoes();

      expect(new Date(batida.payload.signedAt).getTime()).toBeGreaterThan(
        new Date(ativacao.payload.signedAt).getTime(),
      );
      expect(depois.last_seen_at.getTime()).toBeGreaterThanOrEqual(
        antes.last_seen_at.getTime(),
      );
      expect(verifyLicenseFile(batida, publicaPem)).toBe(true);
    });

    it('atualiza `appVersion` quando vem, e preserva quando não vem', async () => {
      // Um cliente que não informa a versão não deve apagar a última conhecida
      // — o suporte usa esse campo para saber o que está rodando lá.
      await service.activate({ key: CHAVE, fingerprint: 'fp-1', appVersion: '1.0.0' });
      await service.heartbeat({ key: CHAVE, fingerprint: 'fp-1', appVersion: '1.1.0' });
      expect((await ativacoes())[0].app_version).toBe('1.1.0');

      await service.heartbeat({ key: CHAVE, fingerprint: 'fp-1' });
      expect((await ativacoes())[0].app_version).toBe('1.1.0');
    });

    it('fingerprint NUNCA ativado → 409 com a lista, sem reativar', async () => {
      await service.activate({ key: CHAVE, fingerprint: 'fp-1', hostname: 'desktop' });

      await expect(
        service.heartbeat({ key: CHAVE, fingerprint: 'fp-desconhecido' }),
      ).rejects.toMatchObject({
        status: 409,
        response: {
          activations: expect.arrayContaining([
            expect.objectContaining({ hostname: 'desktop' }),
          ]),
        },
      });

      // E não criou linha nenhuma: reativar em silêncio aqui tornaria o
      // `maxMachines` decorativo — bastaria pular o `/activate`.
      expect(await ativacoes()).toHaveLength(1);
    });

    it('fingerprint DESATIVADO → 409, não revive sozinho', async () => {
      await service.activate({ key: CHAVE, fingerprint: 'fp-1' });
      await service.deactivate({ key: CHAVE, fingerprint: 'fp-1' });

      await expect(
        service.heartbeat({ key: CHAVE, fingerprint: 'fp-1' }),
      ).rejects.toMatchObject({ status: 409 });

      expect((await ativacoes())[0].deactivated_at).not.toBeNull();
    });

    it('licença revogada → 410', async () => {
      await expect(
        service.heartbeat({ key: CHAVE_REVOGADA, fingerprint: 'fp-1' }),
      ).rejects.toMatchObject({ status: 410 });
    });

    it('chave inexistente → 404', async () => {
      await expect(
        service.heartbeat({ key: 'WR-ZZZZ-ZZZZ-ZZZZ-ZZZZ', fingerprint: 'fp-1' }),
      ).rejects.toMatchObject({ status: 404 });
    });

    it('registra `heartbeat` na trilha', async () => {
      await service.activate({ key: CHAVE, fingerprint: 'fp-1' });
      await service.heartbeat({ key: CHAVE, fingerprint: 'fp-1' });
      expect(await eventos()).toEqual(['activated', 'heartbeat']);
    });
  });

  describe('deactivate', () => {
    it('pelo próprio fingerprint marca a data e devolve as vagas livres', async () => {
      await service.activate({ key: CHAVE, fingerprint: 'fp-1' });

      const r = await service.deactivate({ key: CHAVE, fingerprint: 'fp-1' });

      expect(r).toEqual({ deactivated: true, remainingSlots: 2 });
      expect((await ativacoes())[0].deactivated_at).not.toBeNull();
    });

    it('é soft: a linha continua no banco, com o histórico', async () => {
      // Apagar esconderia a troca do suporte e zeraria o contador de trocas,
      // que é o sinal de abuso do §Escopo.
      await service.activate({ key: CHAVE, fingerprint: 'fp-1', hostname: 'antigo' });
      await service.deactivate({ key: CHAVE, fingerprint: 'fp-1' });

      const linhas = await ativacoes();
      expect(linhas).toHaveLength(1);
      expect(linhas[0].hostname).toBe('antigo');
    });

    it('é idempotente e NÃO grava evento na repetição', async () => {
      // Evento duplicado inflaria o contador de trocas e faria o sinal de abuso
      // disparar por retry de rede.
      await service.activate({ key: CHAVE, fingerprint: 'fp-1' });
      await service.deactivate({ key: CHAVE, fingerprint: 'fp-1' });
      const primeira = (await ativacoes())[0].deactivated_at;

      const r = await service.deactivate({ key: CHAVE, fingerprint: 'fp-1' });

      expect(r.deactivated).toBe(true);
      expect((await ativacoes())[0].deactivated_at).toEqual(primeira);
      expect(await eventos()).toEqual(['activated', 'deactivated']);
    });

    it('por `activationId` de OUTRA máquina da mesma licença funciona', async () => {
      // É o que torna a troca possível quando o computador antigo não está mais
      // acessível — o caso comum de quem trocou de máquina.
      await service.activate({ key: CHAVE, fingerprint: 'fp-antiga', hostname: 'velho' });
      await service.activate({ key: CHAVE, fingerprint: 'fp-nova' });

      const antiga = (await ativacoes()).find((a) => a.fingerprint === 'fp-antiga')!;
      const r = await service.deactivate({ key: CHAVE, activationId: antiga.id });

      expect(r).toEqual({ deactivated: true, remainingSlots: 1 });
    });

    it('`activationId` de outra LICENÇA responde 404, como inexistente', async () => {
      // Não confirmar a existência é o que evita enumerar ativações alheias com
      // ids adivinhados (§Notas técnicas).
      await service.activate({ key: CHAVE_OUTRA, fingerprint: 'fp-do-outro' });
      const alheia = (await ativacoes('lflic-b'))[0];

      const doOutro = service.deactivate({ key: CHAVE, activationId: alheia.id });
      const inexistente = service.deactivate({ key: CHAVE, activationId: 'nao-existe' });

      await expect(doOutro).rejects.toMatchObject({ status: 404 });
      await expect(inexistente).rejects.toMatchObject({ status: 404 });
      // E a ativação alheia continua viva: a tentativa não a tocou.
      expect((await ativacoes('lflic-b'))[0].deactivated_at).toBeNull();
    });

    it('recusa `fingerprint` e `activationId` juntos com 400', async () => {
      // Aceitar ambos exigiria decidir qual vence quando apontam para máquinas
      // diferentes — e qualquer escolha desativaria em silêncio uma que o
      // cliente não pediu.
      await expect(
        service.deactivate({ key: CHAVE, fingerprint: 'fp-1', activationId: 'x' }),
      ).rejects.toMatchObject({ status: 400 });
    });

    it('recusa nenhum dos dois com 400', async () => {
      await expect(service.deactivate({ key: CHAVE })).rejects.toMatchObject({
        status: 400,
      });
    });

    it('licença revogada → 410', async () => {
      await expect(
        service.deactivate({ key: CHAVE_REVOGADA, fingerprint: 'fp-1' }),
      ).rejects.toMatchObject({ status: 410 });
    });
  });

  describe('o ciclo completo da troca de máquina', () => {
    it('2 vagas cheias → 409; desativar uma → a 3ª entra e o total volta a 2', async () => {
      // É o critério de aceite da fatia, ponta a ponta.
      await service.activate({ key: CHAVE, fingerprint: 'fp-1', hostname: 'desktop' });
      await service.activate({ key: CHAVE, fingerprint: 'fp-2', hostname: 'notebook' });

      await expect(
        service.activate({ key: CHAVE, fingerprint: 'fp-3' }),
      ).rejects.toMatchObject({ status: 409 });

      await service.deactivate({ key: CHAVE, fingerprint: 'fp-1' });
      await expect(
        service.activate({ key: CHAVE, fingerprint: 'fp-3' }),
      ).resolves.toBeDefined();

      const vivas = (await ativacoes()).filter((a) => a.deactivated_at === null);
      expect(vivas).toHaveLength(2);
      expect(vivas.map((a) => a.fingerprint).sort()).toEqual(['fp-2', 'fp-3']);
    });

    it('reativar um fingerprint desativado com as vagas cheias → 409', async () => {
      // Voltar NÃO é retorno gratuito: sem esta regra, desativar e reativar em
      // ciclo tornaria o `maxMachines` decorativo.
      await service.activate({ key: CHAVE, fingerprint: 'fp-1' });
      await service.activate({ key: CHAVE, fingerprint: 'fp-2' });
      await service.deactivate({ key: CHAVE, fingerprint: 'fp-1' });
      await service.activate({ key: CHAVE, fingerprint: 'fp-3' });

      await expect(
        service.activate({ key: CHAVE, fingerprint: 'fp-1' }),
      ).rejects.toMatchObject({ status: 409 });
    });

    it('reativar com vaga livre reocupa a MESMA linha, não cria a segunda', async () => {
      // `update` e não `create`: o unique `(license_id, fingerprint)` recusaria
      // a segunda linha, e a trilha da máquina continua inteira.
      await service.activate({ key: CHAVE, fingerprint: 'fp-1' });
      await service.deactivate({ key: CHAVE, fingerprint: 'fp-1' });
      await service.activate({ key: CHAVE, fingerprint: 'fp-1' });

      const linhas = await ativacoes();
      expect(linhas).toHaveLength(1);
      expect(linhas[0].deactivated_at).toBeNull();
      expect(await eventos()).toEqual(['activated', 'deactivated', 'reactivated']);
    });
  });

  describe('admin', () => {
    it('desativa máquina de qualquer licença do tenant, com evento próprio', async () => {
      // A trilha precisa distinguir "o cliente trocou" de "o suporte interveio".
      await service.activate({ key: CHAVE, fingerprint: 'fp-1' });
      const [linha] = await ativacoes();

      const r = await prisma.runInTenantContext([TENANT], () =>
        admin.deactivateActivation(TENANT, 'lflic', linha.id),
      );

      expect(r.deactivatedAt).not.toBeNull();
      expect(await eventos()).toEqual(['activated', 'deactivated_by_admin']);
    });

    it('tenant B não desativa máquina do tenant A', async () => {
      // O RLS corta, e o `where` explícito também — duas barreiras para o mesmo.
      await service.activate({ key: CHAVE, fingerprint: 'fp-1' });
      const [linha] = await ativacoes();

      await expect(
        prisma.runInTenantContext([OUTRO_TENANT], () =>
          admin.deactivateActivation(OUTRO_TENANT, 'lflic', linha.id),
        ),
      ).rejects.toMatchObject({ status: 404 });

      expect((await ativacoes())[0].deactivated_at).toBeNull();
    });

    it('o detalhe mostra as desativadas, com data, fora da contagem', async () => {
      // A diferença que o suporte precisa: "esta máquina existiu e saiu em tal
      // data" é o que uma lista só das vivas não responde.
      await service.activate({ key: CHAVE, fingerprint: 'fp-1', hostname: 'velho' });
      await service.activate({ key: CHAVE, fingerprint: 'fp-2', hostname: 'novo' });
      await service.deactivate({ key: CHAVE, fingerprint: 'fp-1' });

      const detalhe = await prisma.runInTenantContext([TENANT], () =>
        admin.detail(TENANT, 'lflic'),
      );

      expect(detalhe.activeMachines).toBe(1);
      expect(detalhe.activations).toHaveLength(2);
      expect(
        detalhe.activations.find((a) => a.hostname === 'velho')!.deactivatedAt,
      ).not.toBeNull();
    });

    it('o contador de trocas reflete a janela e é derivado da trilha', async () => {
      // Sem coluna nova: uma que alguém esquecesse de incrementar mentiria em
      // silêncio (§Notas técnicas).
      await service.activate({ key: CHAVE, fingerprint: 'fp-1' });
      await service.deactivate({ key: CHAVE, fingerprint: 'fp-1' });
      await service.activate({ key: CHAVE, fingerprint: 'fp-1' });

      const detalhe = await prisma.runInTenantContext([TENANT], () =>
        admin.detail(TENANT, 'lflic'),
      );

      // 1 `deactivated` + 1 `reactivated`. O `activated` inicial não conta —
      // ativar a primeira vez não é troca.
      expect(detalhe.swapCount).toBe(2);
      expect(detalhe.swapWindowDays).toBeGreaterThan(0);
    });

    it('detalhe de licença de outro tenant é 404', async () => {
      await expect(
        prisma.runInTenantContext([OUTRO_TENANT], () =>
          admin.detail(OUTRO_TENANT, 'lflic'),
        ),
      ).rejects.toMatchObject({ status: 404 });
    });
  });
});
