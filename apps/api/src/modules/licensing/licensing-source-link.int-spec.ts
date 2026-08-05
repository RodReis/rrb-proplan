/**
 * A coleta de username contra Postgres REAL (SPEC-039 §Contratos).
 *
 * **Por que int-spec e não mock, aqui especificamente.** `GET /s/:token` é rota
 * **sem sessão que escreve** — a segunda do produto, depois do `/activate`. As
 * quatro coisas que podem dar errado são todas silenciosas com mock:
 *
 * 1. **Fail-closed no lookup.** Sem a `resolve_source_link`, o SELECT roda sem
 *    `app.tenant_ids` e devolve ZERO LINHAS — para *todo* token, inclusive os
 *    válidos. A rota responderia "link inválido" a cada comprador legítimo, sem
 *    erro em log. Um mock do Prisma "resolveria" normalmente.
 * 2. **Fail-closed na escrita.** Sem `runInTenantContext`, o `update` do username
 *    não dá erro: grava ZERO LINHAS. A rota devolveria `200` e o username não
 *    estaria em lugar nenhum — o comprador esperaria o convite para sempre.
 * 3. **`resolve_source_link` sem `EXECUTE`.** A role `proplan_app` é a mesma da
 *    aplicação; só aqui o `REVOKE`/`GRANT` da migration é exercitado de verdade.
 * 4. **O uso único sob corrida.** É o `WHERE used_at IS NULL` do `updateMany` que
 *    decide, e num objeto de mentira ele sempre "afeta 1 linha".
 */
import { PrismaClient } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ownerClient, applyMigrations, grantAppRole } from '../../../test/int/db-harness';
import { SourceLinkService, SourceLinkUsedError } from './application/source-link.service';
import type { MailService } from '../mail/application/mail.service';
import type { SourceInviteService } from './application/source-invite.service';
import type { GithubSourceClient } from './infrastructure/github-source.client';
import { hashToken } from './domain/source-token';

const TENANT = '00000000-0000-4000-8000-50c1e11a0001';
const OUTRO_TENANT = '00000000-0000-4000-8000-50c1e11a0002';

const USUARIO = { login: 'RodReis', name: 'Rodrigo', avatarUrl: 'https://a/1' };

describe('SPEC-039: coleta de username sem sessão', () => {
  let owner: PrismaClient;
  let prisma: PrismaService;
  let service: SourceLinkService;
  const enviados: Array<Record<string, unknown>> = [];
  /** Tenants para os quais o gatilho da SPEC-048 antecipou a rodada. */
  const reconciliacoes: string[] = [];

  beforeAll(async () => {
    applyMigrations();
    owner = ownerClient();

    // **O `PrismaService` lê `DATABASE_URL` do `.env`**, que aponta para o banco
    // de DEV. Sem esta linha o service escreveria num banco e o `owner` leria
    // noutro: o seed "não existiria" para o service e todo teste falharia com
    // "licença não encontrada" — foi exatamente o que aconteceu aqui, e o
    // int-spec do `/activate` carrega o mesmo aviso desde a SPEC-036.
    process.env.DATABASE_URL =
      process.env.TEST_DATABASE_URL ??
      'postgresql://proplan_app:proplan_app@localhost:5433/proplan_test';
    prisma = new PrismaService();
    await prisma.$connect();
    await grantAppRole(owner);
    await semear();

    // O `mail` e o GitHub são dobrados de propósito: o que este arquivo prova é o
    // BANCO (RLS, função, uso único), não o provedor de e-mail nem a API externa
    // — esses têm testes de regra próprios.
    const mail = {
      send: async (input: Record<string, unknown>) => {
        enviados.push(input);
        return 'entrega';
      },
    } as unknown as MailService;
    const github = { findUser: async () => USUARIO } as unknown as GithubSourceClient;

    // Dobro do gatilho da SPEC-048 pelo mesmo critério do `mail`: o que este
    // arquivo prova é o BANCO. Registrar as chamadas serve ao teste do gatilho
    // mais abaixo — que ele DISPARA, e com o tenant certo.
    const invites = {
      agendarReconciliacao: async (tenantId: string) => {
        reconciliacoes.push(tenantId);
      },
    } as unknown as SourceInviteService;

    service = new SourceLinkService(prisma, mail, github, invites);
  });

  afterAll(async () => {
    await limpar();
    await prisma.$disconnect();
    await owner.$disconnect();
  });

  beforeEach(async () => {
    enviados.length = 0;
    await owner.$executeRawUnsafe(
      `DELETE FROM lic_source_links WHERE tenant_id = ANY($1)`,
      [TENANT, OUTRO_TENANT],
    );
    // A trilha é append-only em produção, mas aqui o resíduo do teste anterior
    // falsearia a contagem de eventos — o assert é sobre QUAIS eventos esta
    // execução gravou, não sobre o acumulado da suíte.
    await owner.$executeRawUnsafe(`DELETE FROM lic_events WHERE tenant_id = ANY($1)`, [
      TENANT,
      OUTRO_TENANT,
    ]);
    await owner.$executeRawUnsafe(
      `UPDATE licenses SET github_username = NULL, source_access = 'PENDING'
       WHERE tenant_id = ANY($1)`,
      [TENANT, OUTRO_TENANT],
    );
  });

  // =========================================================================
  // O caminho completo, como o comprador o percorre
  // =========================================================================

  it('cria o link, resolve sem sessão, grava o username e queima o link', async () => {
    const { token } = await prisma.runInTenantContext([TENANT], () =>
      service.createAndSend(TENANT, 'srclnk-lic-a'),
    );

    // **Fora de qualquer contexto de tenant daqui para baixo** — é assim que a
    // rota pública roda. Se a `resolve_source_link` não existisse ou não tivesse
    // `EXECUTE`, tudo abaixo falharia.
    const aberto = await service.resolvePublic(token);
    expect(aberto).toEqual({
      status: 'valid',
      product: 'War Room',
      edition: 'Com código-fonte',
    });

    const gravado = await service.setUsername(token, 'rodreis', true);
    expect(gravado).toEqual({ username: 'RodReis' });

    // A escrita chegou ao banco de verdade. Sem `runInTenantContext` dentro do
    // service, o update afetaria zero linhas **sem erro** e este SELECT veria
    // `null` — o `200` da rota seria uma mentira.
    const [licenca] = await owner.$queryRawUnsafe<
      { github_username: string; source_access: string }[]
    >(`SELECT github_username, source_access FROM licenses WHERE id = 'srclnk-lic-a'`);
    expect(licenca.github_username).toBe('RodReis');
    // `PENDING`, não `INVITED`: o convite ainda não saiu.
    expect(licenca.source_access).toBe('PENDING');

    // Gatilho por evento (SPEC-048): gravar o username antecipa a rodada, com o
    // tenant resolvido a partir do TOKEN — não de sessão, que aqui não existe.
    // Passar o tenant errado faria a rodada varrer outro tenant e o convite
    // deste comprador nunca sairia, sem erro em lugar nenhum.
    expect(reconciliacoes).toEqual([TENANT]);

    // E o link morreu: reabrir mostra "já utilizado", nunca o formulário.
    expect((await service.resolvePublic(token)).status).toBe('used');
  });

  it('o segundo POST com o mesmo token é recusado, não sobrescreve', async () => {
    const { token } = await prisma.runInTenantContext([TENANT], () =>
      service.createAndSend(TENANT, 'srclnk-lic-a'),
    );

    await service.setUsername(token, 'RodReis', true);

    // A guarda é o `WHERE used_at IS NULL` do `updateMany`, no BANCO. Um `if`
    // antes do update deixaria as duas requisições passarem — e quem tivesse a
    // URL sobrescreveria o dado de quem comprou.
    await expect(service.setUsername(token, 'outro', true)).rejects.toThrow(
      SourceLinkUsedError,
    );
  });

  it('criar um link novo invalida o anterior', async () => {
    const primeiro = await prisma.runInTenantContext([TENANT], () =>
      service.createAndSend(TENANT, 'srclnk-lic-a'),
    );
    const segundo = await prisma.runInTenantContext([TENANT], () =>
      service.createAndSend(TENANT, 'srclnk-lic-a'),
    );

    // Dois links vivos significaria que usar um não fecha o outro — e o uso único
    // deixaria de ser único.
    expect((await service.resolvePublic(primeiro.token)).status).toBe('used');
    expect((await service.resolvePublic(segundo.token)).status).toBe('valid');
  });

  // =========================================================================
  // Isolamento e não-diferenciação
  // =========================================================================

  it('token de outro tenant responde igual a inexistente', async () => {
    const { token } = await prisma.runInTenantContext([OUTRO_TENANT], () =>
      service.createAndSend(OUTRO_TENANT, 'srclnk-lic-b'),
    );

    // O token do tenant B resolve — e tem de resolver, porque a rota é a mesma
    // para todos os tenants; o que a função devolve é o tenant DELE.
    const doOutro = await service.resolvePublic(token);
    expect(doOutro.status).toBe('valid');

    // Já um token que não existe em tenant nenhum: mesma resposta de um inválido.
    // A função não encontra nada, e não há como distinguir os dois casos.
    const inexistente = await service.resolvePublic('token-que-nunca-existiu');
    expect(inexistente).toEqual({ status: 'invalid' });
  });

  it('grava no tenant do TOKEN, nunca em outro', async () => {
    const { token } = await prisma.runInTenantContext([OUTRO_TENANT], () =>
      service.createAndSend(OUTRO_TENANT, 'srclnk-lic-b'),
    );

    await service.setUsername(token, 'RodReis', true);

    // O tenant sai do hash do token (ADR-020), não de nada que venha no request.
    // Se o service usasse um tenant vindo de fora, a escrita cairia na licença
    // errada — ou em nenhuma, silenciosamente.
    const linhas = await owner.$queryRawUnsafe<{ id: string; github_username: string }[]>(
      `SELECT id, github_username FROM licenses
       WHERE github_username IS NOT NULL ORDER BY id`,
    );
    expect(linhas).toEqual([{ id: 'srclnk-lic-b', github_username: 'RodReis' }]);
  });

  it('licença revogada não coleta username', async () => {
    const { token } = await prisma.runInTenantContext([TENANT], () =>
      service.createAndSend(TENANT, 'srclnk-lic-a'),
    );
    // `revoked_at` e `revoked_reason` vão junto: o CHECK
    // `licenses_revoked_coherent` (SPEC-036) recusa `REVOKED` sem data — e recusar
    // é o certo, uma revogação sem quando/por quê não explica nada no suporte.
    await owner.$executeRawUnsafe(
      `UPDATE licenses SET status = 'REVOKED', revoked_at = now(),
              revoked_reason = 'reembolso' WHERE id = 'srclnk-lic-a'`,
    );

    // Coletar dado pessoal de quem foi reembolsado seria coletar sem finalidade
    // (LGPD): o convite nunca sairia. E responde `invalid`, sem estado próprio —
    // um estado a mais vazaria que a licença existiu.
    expect(await service.resolvePublic(token)).toEqual({ status: 'invalid' });
    await expect(service.setUsername(token, 'RodReis', true)).rejects.toThrow();

    await owner.$executeRawUnsafe(
      `UPDATE licenses SET status = 'ACTIVE', revoked_at = NULL, revoked_reason = NULL
       WHERE id = 'srclnk-lic-a'`,
    );
  });

  // =========================================================================
  // O que persiste, e o que não
  // =========================================================================

  it('só o hash do token vai para o banco', async () => {
    const { token } = await prisma.runInTenantContext([TENANT], () =>
      service.createAndSend(TENANT, 'srclnk-lic-a'),
    );

    const [linha] = await owner.$queryRawUnsafe<{ token_hash: string }[]>(
      `SELECT token_hash FROM lic_source_links WHERE license_id = 'srclnk-lic-a'`,
    );
    // Vazamento do banco não entrega acesso a código-fonte.
    expect(linha.token_hash).toBe(hashToken(token));
    expect(linha.token_hash).not.toBe(token);
  });

  it('o token não aparece na trilha', async () => {
    const { token } = await prisma.runInTenantContext([TENANT], () =>
      service.createAndSend(TENANT, 'srclnk-lic-a'),
    );
    await service.setUsername(token, 'RodReis', true);

    const eventos = await owner.$queryRawUnsafe<{ type: string; payload: unknown }[]>(
      `SELECT type, payload FROM lic_events WHERE license_id = 'srclnk-lic-a'
       ORDER BY created_at`,
    );

    // Critério de aceite: nem em log, nem em `LicEvent.payload`, nem em mensagem
    // de erro. A trilha registra os dois eventos, com o login (que é público) e
    // sem o token (que não é).
    expect(eventos.map((e) => e.type)).toEqual([
      'source_invite_sent',
      'source_username_set',
    ]);
    expect(JSON.stringify(eventos)).not.toContain(token);
    expect(JSON.stringify(eventos)).toContain('RodReis');
  });

  // =========================================================================
  // Fixtures
  // =========================================================================

  async function semear() {
    for (const [tenant, sufixo] of [
      [TENANT, 'a'],
      [OUTRO_TENANT, 'b'],
    ] as const) {
      await owner.$executeRawUnsafe(
        `INSERT INTO tenants (id, installation_id, account_login, account_type, created_at)
         VALUES ($1, NULL, $2, 'User', now()) ON CONFLICT (id) DO NOTHING`,
        tenant,
        `srclnk-${sufixo}`,
      );
      await owner.$executeRawUnsafe(
        `INSERT INTO lic_products (id, tenant_id, slug, name, key_prefix, source_repo,
                                   created_at, updated_at)
         VALUES ($1, $2, 'warroom', 'War Room', 'WR', 'RodReis/war-room', now(), now())
         ON CONFLICT (id) DO NOTHING`,
        `srclnk-prod-${sufixo}`,
        tenant,
      );
      await owner.$executeRawUnsafe(
        `INSERT INTO lic_editions (id, product_id, slug, name, billing_model, max_machines,
                                   updates_months, grants_source_access, created_at, updated_at)
         VALUES ($1, $2, 'completa', 'Com código-fonte', 'PERPETUAL', 2, 12, true,
                 now(), now())
         ON CONFLICT (id) DO NOTHING`,
        `srclnk-edi-${sufixo}`,
        `srclnk-prod-${sufixo}`,
      );
      await owner.$executeRawUnsafe(
        `INSERT INTO licenses (id, tenant_id, edition_id, key_hash, status, customer_email,
                               issued_at, updates_until, source_invite_at, source_access,
                               created_at, updated_at)
         VALUES ($1, $2, $3, $4, 'ACTIVE', 'comprador@exemplo.com', now(),
                 now() + interval '12 months', now() + interval '8 days', 'PENDING',
                 now(), now())
         ON CONFLICT (id) DO NOTHING`,
        `srclnk-lic-${sufixo}`,
        tenant,
        `srclnk-edi-${sufixo}`,
        `hash-srclnk-${sufixo}`,
      );
    }
  }

  async function limpar() {
    const ids = [TENANT, OUTRO_TENANT];
    for (const tabela of [
      'lic_source_links',
      'lic_events',
      'mail_deliveries',
      'licenses',
      'lic_products',
    ]) {
      await owner.$executeRawUnsafe(`DELETE FROM ${tabela} WHERE tenant_id = ANY($1)`, ids);
    }
    await owner.$executeRawUnsafe(`DELETE FROM tenants WHERE id = ANY($1)`, ids);
  }
});
