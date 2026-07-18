/**
 * O Proxy do PrismaService roteia o acesso a model para o tx de contexto
 * (SPEC-022). Prova o bug que quebrou o workspace ao vivo (2026-07-18): um
 * service que chama `this.prisma.project.findFirst` DENTRO de withTenant tem de
 * enxergar o projeto — sem o Proxy, usaria outra conexão do pool sem o SET LOCAL
 * e o RLS retornaria null (404 "Projeto não encontrado").
 *
 * Usa o PrismaService REAL (com o Proxy), apontado ao banco de teste como
 * proplan_app (não-owner, sujeito a RLS) via DATABASE_URL.
 */
import { ownerClient, applyMigrations, grantAppRole } from '../../test/int/db-harness';
import type { PrismaClient } from '@prisma/client';

const TENANT = '00000000-0000-4000-8000-dddddddddddd';
const APP_URL =
  process.env.TEST_DATABASE_URL ??
  'postgresql://proplan_app:proplan_app@localhost:5433/proplan_test';

describe('PrismaService Proxy: model access roteia para o tx de contexto', () => {
  let owner: PrismaClient;
  let prisma: import('./prisma.service').PrismaService;

  beforeAll(async () => {
    applyMigrations();
    owner = ownerClient();
    await grantAppRole(owner);

    await owner.$executeRawUnsafe(
      `INSERT INTO users (id, github_id, login, created_at, updated_at)
       VALUES ('px-u', 701, 'px', now(), now()) ON CONFLICT (id) DO NOTHING`,
    );
    await owner.$executeRawUnsafe(
      `INSERT INTO tenants (id, account_login, account_type, created_at)
       VALUES ('${TENANT}', 'px', 'User', now()) ON CONFLICT (id) DO NOTHING`,
    );
    await owner.$executeRawUnsafe(
      `INSERT INTO projects (id, user_id, tenant_id, github_repo_id, owner, name, default_branch, is_private, created_at)
       VALUES ('px-p', 'px-u', '${TENANT}', 7010, 'px', 'repo', 'main', false, now())
       ON CONFLICT (id) DO NOTHING`,
    );

    // PrismaService lê DATABASE_URL do env — aponta ao test-app antes de instanciar.
    process.env.DATABASE_URL = APP_URL;
    const { PrismaService } = await import('./prisma.service');
    prisma = new PrismaService();
    await prisma.$connect();
  });

  afterAll(async () => {
    await owner.$executeRawUnsafe(`DELETE FROM projects WHERE id = 'px-p'`);
    await owner.$executeRawUnsafe(`DELETE FROM tenants WHERE id = '${TENANT}'`);
    await owner.$executeRawUnsafe(`DELETE FROM users WHERE id = 'px-u'`);
    await prisma.$disconnect();
    await owner.$disconnect();
  });

  it('findFirst via this.prisma DENTRO de withTenant acha o projeto', async () => {
    const found = await prisma.withTenant([TENANT], async () => {
      // Simula o que um service faz: acessa o model pelo client base — o Proxy
      // redireciona para o tx de contexto.
      return prisma.project.findFirst({ where: { id: 'px-p' } });
    });
    expect(found?.id).toBe('px-p');
  });

  it('findFirst FORA de withTenant não acha (fail-closed sob RLS)', async () => {
    const found = await prisma.project.findFirst({ where: { id: 'px-p' } });
    expect(found).toBeNull();
  });
});
