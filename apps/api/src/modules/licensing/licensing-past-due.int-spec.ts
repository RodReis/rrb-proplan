/**
 * Corte por inadimplência (SPEC-038, PR-4) contra Postgres REAL.
 *
 * **Por que int-spec, e não mock.** O corte depende de três coisas que só
 * existem no banco, e um mock afirmaria cada uma sem provar nenhuma:
 *
 * 1. **A `resolve_past_due_tolerance` é `SECURITY DEFINER`.** É a única forma de
 *    `/activate` e `/heartbeat` — que rodam **sem sessão** — lerem a tolerância:
 *    `lic_settings` é fail-closed sob RLS. Se o `GRANT EXECUTE` da migration
 *    faltar, ou se alguém trocar a chamada por um `findUnique`, a leitura volta
 *    vazia, a tolerância é lida como `null` e **o corte nunca acontece**. Um
 *    mock devolveria 15 alegremente.
 * 2. **A `resolve_license` tem de devolver `past_due_at`.** A coluna existe desde
 *    o PR-1 e o PR-3 já a grava; sem estar na função, o gate não tem o que
 *    comparar. Este é o defeito silencioso que o PR-4 fecha.
 * 3. **O evento do corte é escrito sob RLS.** Fora de `runInTenantContext` o
 *    `create` grava zero linhas sem erro, e a trilha do painel (SPEC-040)
 *    nasceria vazia sem nada falhando.
 *
 * O caso que mais interessa é o **410 com tolerância `null`** — porque ele deve
 * responder `200`. É a decisão PI #3 invertida ao contrário: quem revoga passa a
 * ser só a plataforma, e ler `null` como "tolerância zero" cortaria a base
 * inteira de um tenant que nunca pediu corte automático.
 */
import { PrismaClient } from '@prisma/client';
import { generateKeyPairSync } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { ownerClient, applyMigrations, grantAppRole } from '../../../test/int/db-harness';
import { LicenseActivationService } from './application/license-activation.service';
import { LicenseSigningService } from './application/license-signing.service';
import { hashKey } from './domain/license-key';
import { PAST_DUE_CUT } from './licensing.constants';

const TENANT = '00000000-0000-4000-8000-11fecd110001';
const TENANT_SEM_CORTE = '00000000-0000-4000-8000-11fecd110002';

/** Atrasada há 20 dias, num tenant com tolerância 15 → tem de cortar. */
const CHAVE_ATRASADA = 'WR-PD01-CD45-EF67-GH89';
/** Atrasada há 3 dias, tolerância 15 → dentro da janela, tem de passar. */
const CHAVE_RECENTE = 'WR-PD02-CD45-EF67-GH89';
/** Atrasada há 400 dias, mas o tenant tem tolerância `null` → nunca corta. */
const CHAVE_SEM_CORTE = 'WR-PD03-CD45-EF67-GH89';
/** Em dia. O caminho comum, que não deve nem consultar a tolerância. */
const CHAVE_EM_DIA = 'WR-PD04-CD45-EF67-GH89';

describe('SPEC-038 PR-4: corte por inadimplência na validação', () => {
  let owner: PrismaClient;
  let prisma: PrismaService;
  let service: LicenseActivationService;

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
    service = new LicenseActivationService(prisma, new LicenseSigningService());

    await semear();
  });

  afterAll(async () => {
    await limpar();
    await owner.$disconnect();
    await (prisma as unknown as PrismaClient).$disconnect();
  });

  beforeEach(async () => {
    await owner.$executeRawUnsafe(
      `DELETE FROM lic_activations WHERE tenant_id = ANY($1)`,
      [TENANT, TENANT_SEM_CORTE],
    );
    await owner.$executeRawUnsafe(`DELETE FROM lic_events WHERE tenant_id = ANY($1)`, [
      TENANT,
      TENANT_SEM_CORTE,
    ]);
  });

  it('corta o /activate quando o atraso passa da tolerância', async () => {
    await expect(
      service.activate({ key: CHAVE_ATRASADA, fingerprint: 'fp-1' }),
    ).rejects.toMatchObject({ status: 410 });
  });

  /**
   * O gate é compartilhado de propósito (`licencaUtilizavel`). Este teste é o
   * que impede alguém de cortar só numa das rotas: sem ele, o `/heartbeat`
   * seguiria reassinando o arquivo de um inadimplente para sempre — e o cliente
   * nunca perderia acesso, porque é o heartbeat que renova a validade offline.
   */
  it('corta o /heartbeat com a mesma regra do /activate', async () => {
    await expect(
      service.heartbeat({ key: CHAVE_ATRASADA, fingerprint: 'fp-1' }),
    ).rejects.toMatchObject({ status: 410 });
  });

  it('deixa passar quando o atraso ainda está dentro da tolerância', async () => {
    const file = await service.activate({
      key: CHAVE_RECENTE,
      fingerprint: 'fp-ok',
    });
    expect(file.payload.licenseId).toBe('pdlic-recente');
  });

  /**
   * Decisão PI #3. Atraso de mais de um ano e o acesso continua: com
   * `pastDueToleranceDays = null`, o ProPlan não corta — quem revoga é a
   * plataforma.
   */
  it('NUNCA corta quando o tenant tem tolerância null', async () => {
    const file = await service.activate({
      key: CHAVE_SEM_CORTE,
      fingerprint: 'fp-sc',
    });
    expect(file.payload.licenseId).toBe('pdlic-semcorte');
  });

  it('não interfere na licença em dia', async () => {
    const file = await service.activate({
      key: CHAVE_EM_DIA,
      fingerprint: 'fp-dia',
    });
    expect(file.payload.licenseId).toBe('pdlic-emdia');
  });

  /**
   * A trilha precisa dizer QUAL corte foi. `past_due_cut` sem o prefixo
   * `webhook_` é o que distingue "a tolerância venceu" de "a plataforma
   * revogou" — são causas diferentes, e o painel da SPEC-040 mostra as duas.
   */
  it('grava LicEvent do corte com tipo próprio, distinguível da revogação', async () => {
    await expect(
      service.activate({ key: CHAVE_ATRASADA, fingerprint: 'fp-ev' }),
    ).rejects.toMatchObject({ status: 410 });

    const eventos = (await owner.$queryRawUnsafe(
      `SELECT type, payload FROM lic_events WHERE license_id = 'pdlic-atrasada'`,
    )) as Array<{ type: string; payload: { toleranceDays: number } }>;

    expect(eventos).toHaveLength(1);
    expect(eventos[0].type).toBe(PAST_DUE_CUT);
    expect(eventos[0].type).not.toMatch(/^webhook_/);
    expect(eventos[0].payload.toleranceDays).toBe(15);
  });

  /**
   * O cliente cortado não para de chamar — o binário tenta de hora em hora. Sem
   * a guarda de idempotência, cada tentativa gravaria uma linha idêntica e
   * afogaria a trilha que o painel lê.
   */
  it('grava o evento UMA vez, por mais que o cliente insista', async () => {
    for (let i = 0; i < 3; i++) {
      await expect(
        service.activate({ key: CHAVE_ATRASADA, fingerprint: `fp-${i}` }),
      ).rejects.toMatchObject({ status: 410 });
    }

    const [{ n }] = (await owner.$queryRawUnsafe(
      `SELECT count(*)::int AS n FROM lic_events WHERE license_id = 'pdlic-atrasada'`,
    )) as Array<{ n: number }>;
    expect(n).toBe(1);
  });

  /**
   * O `status` NÃO muda: a spec diz que `pastDueAt` registra a inadimplência
   * *sem mudar `status`*, e o caminho de volta do PR-3 (pagamento aprovado limpa
   * `pastDueAt`) só funciona porque a licença continua `ACTIVE`. Virar para um
   * estado novo aqui deixaria o cliente que pagou travado.
   */
  it('mantém a licença ACTIVE — o corte é reversível pelo caminho de volta', async () => {
    await expect(
      service.activate({ key: CHAVE_ATRASADA, fingerprint: 'fp-st' }),
    ).rejects.toMatchObject({ status: 410 });

    const [linha] = (await owner.$queryRawUnsafe(
      `SELECT status::text FROM licenses WHERE id = 'pdlic-atrasada'`,
    )) as Array<{ status: string }>;
    expect(linha.status).toBe('ACTIVE');
  });

  /**
   * O caminho de volta, provado de ponta a ponta: limpar `pastDueAt` — que é o
   * que o PR-3 faz ao receber pagamento aprovado — restaura o acesso na hora,
   * sem ninguém mexer no admin. Sem isto, o corte automático viraria fila de
   * suporte.
   */
  it('limpar pastDueAt restaura o acesso imediatamente', async () => {
    await expect(
      service.activate({ key: CHAVE_ATRASADA, fingerprint: 'fp-volta' }),
    ).rejects.toMatchObject({ status: 410 });

    await owner.$executeRawUnsafe(
      `UPDATE licenses SET past_due_at = NULL WHERE id = 'pdlic-atrasada'`,
    );
    const file = await service.activate({
      key: CHAVE_ATRASADA,
      fingerprint: 'fp-volta',
    });
    expect(file.payload.licenseId).toBe('pdlic-atrasada');

    // Restaura o cenário para os outros testes (a ordem não deve importar).
    await owner.$executeRawUnsafe(
      `UPDATE licenses SET past_due_at = now() - interval '20 days'
       WHERE id = 'pdlic-atrasada'`,
    );
  });

  /**
   * A prova de que a leitura passa pela função privilegiada: sem `EXECUTE`, a
   * chamada levanta erro de permissão em vez de devolver `null` silencioso. Se
   * um refactor trocar a função por um `findUnique`, este teste continua verde —
   * mas o de cima (`corta o /activate`) quebra, porque o RLS devolveria vazio.
   */
  it('a role da aplicação tem EXECUTE na resolve_past_due_tolerance', async () => {
    const linhas = (await (prisma as unknown as PrismaClient).$queryRawUnsafe(
      `SELECT resolve_past_due_tolerance($1) AS dias`,
      TENANT,
    )) as Array<{ dias: number | null }>;
    expect(linhas[0].dias).toBe(15);
  });

  async function semear() {
    for (const [tenant, sufixo, tolerancia] of [
      [TENANT, 'a', '15'],
      [TENANT_SEM_CORTE, 'b', 'NULL'],
    ] as const) {
      await owner.$executeRawUnsafe(
        `INSERT INTO tenants (id, installation_id, account_login, account_type, created_at)
         VALUES ($1, NULL, $2, 'User', now()) ON CONFLICT (id) DO NOTHING`,
        tenant,
        `pd-${sufixo}`,
      );
      await owner.$executeRawUnsafe(
        `INSERT INTO lic_products (id, tenant_id, slug, name, key_prefix, created_at, updated_at)
         VALUES ($1, $2, 'warroom', 'War Room', 'WR', now(), now())
         ON CONFLICT (id) DO NOTHING`,
        `pdprod-${sufixo}`,
        tenant,
      );
      await owner.$executeRawUnsafe(
        `INSERT INTO lic_editions (id, product_id, slug, name, billing_model,
                                   max_machines, updates_months, created_at, updated_at)
         VALUES ($1, $2, 'closed', 'Sem código-fonte', 'SUBSCRIPTION', 2, 12, now(), now())
         ON CONFLICT (id) DO NOTHING`,
        `pdedi-${sufixo}`,
        `pdprod-${sufixo}`,
      );
      // A tolerância é o dado central desta suíte: 15 num tenant, `null` no
      // outro. É o que separa "corta" de "nunca corta".
      await owner.$executeRawUnsafe(
        `INSERT INTO lic_settings (id, tenant_id, webhook_secret,
                                   past_due_tolerance_days, created_at, updated_at)
         VALUES ($1, $2, 'segredo-de-teste', ${tolerancia}, now(), now())
         ON CONFLICT (tenant_id) DO UPDATE SET past_due_tolerance_days = ${tolerancia}`,
        `pdset-${sufixo}`,
        tenant,
      );
    }

    const licencas: Array<[string, string, string, string, string]> = [
      ['pdlic-atrasada', TENANT, 'pdedi-a', CHAVE_ATRASADA, `now() - interval '20 days'`],
      ['pdlic-recente', TENANT, 'pdedi-a', CHAVE_RECENTE, `now() - interval '3 days'`],
      [
        'pdlic-semcorte',
        TENANT_SEM_CORTE,
        'pdedi-b',
        CHAVE_SEM_CORTE,
        `now() - interval '400 days'`,
      ],
      ['pdlic-emdia', TENANT, 'pdedi-a', CHAVE_EM_DIA, 'NULL'],
    ];

    for (const [id, tenant, edicao, chave, pastDue] of licencas) {
      await owner.$executeRawUnsafe(
        `INSERT INTO licenses (id, tenant_id, edition_id, key_hash, status,
                               customer_email, issued_at, updates_until,
                               expires_at, past_due_at, created_at, updated_at)
         VALUES ($1, $2, $3, $4, 'ACTIVE', 'comprador@exemplo.com', now(),
                 now() + interval '12 months', now() + interval '12 months',
                 ${pastDue}, now(), now())
         ON CONFLICT (id) DO NOTHING`,
        id,
        tenant,
        edicao,
        hashKey(chave),
      );
    }
  }

  async function limpar() {
    const ids = [TENANT, TENANT_SEM_CORTE];
    await owner.$executeRawUnsafe(`DELETE FROM lic_events WHERE tenant_id = ANY($1)`, ids);
    await owner.$executeRawUnsafe(
      `DELETE FROM lic_activations WHERE tenant_id = ANY($1)`,
      ids,
    );
    await owner.$executeRawUnsafe(`DELETE FROM licenses WHERE tenant_id = ANY($1)`, ids);
    await owner.$executeRawUnsafe(`DELETE FROM lic_settings WHERE tenant_id = ANY($1)`, ids);
    await owner.$executeRawUnsafe(`DELETE FROM lic_editions WHERE id = ANY($1)`, [
      'pdedi-a',
      'pdedi-b',
    ]);
    await owner.$executeRawUnsafe(`DELETE FROM lic_products WHERE tenant_id = ANY($1)`, ids);
    await owner.$executeRawUnsafe(`DELETE FROM tenants WHERE id = ANY($1)`, ids);
  }
});
