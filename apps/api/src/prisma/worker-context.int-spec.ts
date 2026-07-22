/**
 * Contexto de tenant POR OPERAÇÃO para workers (`runInTenantContext`) contra
 * Postgres real (SPEC-022 — correção do PR-6). Prova as três propriedades que
 * o bug do sync violava:
 *
 *  1. Dentro do contexto, o Proxy do PrismaService roteia `svc.<model>` para o
 *     client estendido e o RLS enxerga o tenant (o sync deixa de morrer no
 *     `syncRun.findUnique`).
 *  2. Fora do contexto, fail-closed permanece (0 linhas) — o mecanismo não
 *     abre brecha.
 *  3. Escrita dentro do contexto COMMITA NA HORA (visível a outra conexão
 *     antes de o callback terminar). É o guard contra regressão para "uma tx
 *     segurada pelo job inteiro": lá, o `status: failed` do catch morreria no
 *     rollback e o run ficaria `queued` para sempre — o sintoma original.
 */
import { PrismaClient } from '@prisma/client';
import { ownerClient, applyMigrations, grantAppRole } from '../../test/int/db-harness';
import { PrismaService } from './prisma.service';

const TENANT_A = '00000000-0000-4000-8000-wcwcwcwcwca';
const TENANT_B = '00000000-0000-4000-8000-wcwcwcwcwcb';

const APP_URL =
  process.env.TEST_DATABASE_URL ??
  'postgresql://proplan_app:proplan_app@localhost:5433/proplan_test';

describe('runInTenantContext: contexto por operação para workers', () => {
  let owner: PrismaClient;
  let svc: PrismaService;

  beforeAll(async () => {
    applyMigrations();
    owner = ownerClient();
    await grantAppRole(owner);

    // O PrismaService real lê DATABASE_URL do env — aponta para a role de app
    // (proplan_app, sujeita a RLS), como em runtime.
    process.env.DATABASE_URL = APP_URL;
    svc = new PrismaService();

    await owner.$executeRawUnsafe(
      `INSERT INTO users (id, github_id, login, created_at, updated_at) VALUES
        ('wc-u-a', 901, 'wca', now(), now()), ('wc-u-b', 902, 'wcb', now(), now())
       ON CONFLICT (id) DO NOTHING`,
    );
    await owner.$executeRawUnsafe(
      `INSERT INTO tenants (id, account_login, account_type, created_at) VALUES
        ('${TENANT_A}', 'wca', 'User', now()), ('${TENANT_B}', 'wcb', 'User', now())
       ON CONFLICT (id) DO NOTHING`,
    );
    await owner.$executeRawUnsafe(
      `INSERT INTO projects (id, user_id, tenant_id, github_repo_id, owner, name, default_branch, is_private, created_at) VALUES
        ('wc-p-a', 'wc-u-a', '${TENANT_A}', 9010, 'wca', 'ra', 'main', false, now()),
        ('wc-p-b', 'wc-u-b', '${TENANT_B}', 9020, 'wcb', 'rb', 'main', false, now())
       ON CONFLICT (id) DO NOTHING`,
    );
  });

  afterAll(async () => {
    await owner.$executeRawUnsafe(`DELETE FROM sync_runs WHERE project_id = 'wc-p-a'`);
    await owner.$executeRawUnsafe(`DELETE FROM projects WHERE id IN ('wc-p-a','wc-p-b')`);
    await owner.$executeRawUnsafe(`DELETE FROM tenants WHERE id IN ('${TENANT_A}','${TENANT_B}')`);
    await owner.$executeRawUnsafe(`DELETE FROM users WHERE id IN ('wc-u-a','wc-u-b')`);
    await owner.$disconnect();
    await svc.$disconnect();
  });

  it('dentro do contexto o worker enxerga o tenant; fora, fail-closed', async () => {
    const inside = await svc.runInTenantContext([TENANT_A], () =>
      svc.project.findUnique({ where: { id: 'wc-p-a' } }),
    );
    expect(inside?.id).toBe('wc-p-a');

    // Fora do contexto: o mesmo acesso cai no client base sem SET → RLS corta.
    const outside = await svc.project.findUnique({ where: { id: 'wc-p-a' } });
    expect(outside).toBeNull();
  });

  it('contexto de A não enxerga projeto de B', async () => {
    const cross = await svc.runInTenantContext([TENANT_A], () =>
      svc.project.findUnique({ where: { id: 'wc-p-b' } }),
    );
    expect(cross).toBeNull();
  });

  it('escrita dentro do contexto commita por operação (visível antes de o job acabar)', async () => {
    await svc.runInTenantContext([TENANT_A], async () => {
      const run = await svc.syncRun.create({
        data: { projectId: 'wc-p-a', status: 'queued' },
      });
      await svc.syncRun.update({
        where: { id: run.id },
        data: { status: 'running' },
      });
      // AINDA dentro do callback: outra conexão (owner) já vê o `running`.
      // Numa tx segurada pelo job inteiro isto viria [] — e o `failed` do
      // catch do sync morreria em rollback (o bug que este teste trava).
      const seen = (await owner.$queryRawUnsafe(
        `SELECT status FROM sync_runs WHERE id = '${run.id}'`,
      )) as Array<{ status: string }>;
      expect(seen.map((r) => r.status)).toEqual(['running']);
    });
  });

  it('$transaction em LOTE sob contexto: 1 operação é segura; delete+insert NÃO é (issue #113)', async () => {
    // Este teste nasceu (PR #86) exercitando `$transaction([deleteMany,
    // createMany])` e passava de forma INTERMITENTE — foi assim que o bug
    // sobreviveu meses. A #113 provou por SQL o porquê: sob
    // `runInTenantContext` cada operação do lote já vem embrulhada na sua
    // própria transação pelo client estendido, então DELETE e INSERT saem em
    // CONEXÕES DIFERENTES e fora de ordem. Não há como o lote garantir
    // atomicidade aqui — o teste antigo cobrava uma promessa que a forma não
    // podia cumprir.
    //
    // O que segue verdadeiro e vale travar: uma operação SOZINHA no lote roda
    // sob o contexto (o `set_config` injetado pelo Proxy vale para ela).
    await svc.runInTenantContext([TENANT_A], () =>
      svc.$transaction([
        svc.documentResolution.createMany({
          data: [
            { projectId: 'wc-p-a', entity: 'architecture', level: 4, source: 'absent', confidence: 0 },
          ],
        }),
      ]),
    );

    const rows = await svc.runInTenantContext([TENANT_A], () =>
      svc.documentResolution.findMany({ where: { projectId: 'wc-p-a' } }),
    );
    expect(rows).toHaveLength(1);

    await owner.$executeRawUnsafe(
      `DELETE FROM document_resolutions WHERE project_id = 'wc-p-a'`,
    );
  });

  it('$transaction(callback) interativo roda sob contexto e numa conexão só (issue #113)', async () => {
    // Forma que o `resolution.rebuild` passou a usar. O lote em array quebra
    // aqui dentro: cada operação vem do client estendido já embrulhada na sua
    // própria transação, então DELETE e INSERT saem em conexões diferentes e
    // fora de ordem — o INSERT commita antes e colide no unique.
    //
    // Na forma interativa o `tx` é UMA conexão para as duas operações. Este
    // teste falha (fail-closed do RLS, ou colisão de unique) se o contexto não
    // for injetado no `tx`.
    const rebuild = () =>
      svc.runInTenantContext([TENANT_A], () =>
        svc.$transaction(async (tx) => {
          await tx.documentResolution.deleteMany({ where: { projectId: 'wc-p-a' } });
          await tx.documentResolution.createMany({
            data: [
              { projectId: 'wc-p-a', entity: 'architecture', level: 4, source: 'absent', confidence: 0 },
              { projectId: 'wc-p-a', entity: 'testing', level: 4, source: 'absent', confidence: 0 },
            ],
          });
        }),
      );

    // 2× prova a idempotência: o 2º delete PRECISA enxergar o que o 1º inseriu.
    // Sem contexto no `tx`, o RLS esconde as linhas e o unique estoura.
    await rebuild();
    await expect(rebuild()).resolves.not.toThrow();

    const rows = await svc.runInTenantContext([TENANT_A], () =>
      svc.documentResolution.findMany({ where: { projectId: 'wc-p-a' } }),
    );
    expect(rows).toHaveLength(2);

    await owner.$executeRawUnsafe(
      `DELETE FROM document_resolutions WHERE project_id = 'wc-p-a'`,
    );
  });

  it('rejeita contexto vazio ou sem tenant (fail fast, não silêncio)', async () => {
    await expect(svc.runInTenantContext([], async () => null)).rejects.toThrow(
      /tenantId/,
    );
    await expect(
      svc.runInTenantContext([''], async () => null),
    ).rejects.toThrow(/tenantId/);
  });
});
