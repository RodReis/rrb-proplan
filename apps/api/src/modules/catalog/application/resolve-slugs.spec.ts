import { NotFoundException } from '@nestjs/common';
import { CatalogService } from './catalog.service';

/**
 * Resolução de slug → ids canônicos (SPEC-028).
 *
 * O que estes testes travam: (1) o slug é conveniência de LEITURA — a
 * identidade continua no id estável, então renomear o repo não pode quebrar a
 * URL por UUID; (2) o universo de busca é o array de membership, então tenant
 * alheio some em vez de ser negado (404 não-diferencial, nunca 403 nem vazamento);
 * (3) o casamento do projeto é escopado ao tenant resolvido — `/t/a/p/x` jamais
 * pode achar o `x` que vive no tenant `b`.
 */

const TENANT_A = '11111111-1111-4111-8111-111111111111';
const TENANT_B = '22222222-2222-4222-8222-222222222222';
const PROJ_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const PROJ_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

type FakeProject = { id: string; name: string; tenantId: string; userId: string };

interface Where {
  userId: string;
  tenantId: string;
  OR: [{ id: string }, { name: { equals: string; mode: string } }];
}

/**
 * Fake do Prisma. `withTenant` recebe o array de contexto e só entrega ao
 * callback os projetos daqueles tenants — é a simulação do RLS: fora do
 * contexto, a linha não existe (fail-closed), e é isso que os testes de
 * isolamento exercitam.
 */
function makeService(opts: {
  memberships: string[];
  tenants: { id: string; accountLogin: string }[];
  projects: FakeProject[];
}) {
  const prisma = {
    membership: {
      findMany: async () => opts.memberships.map((tenantId) => ({ tenantId })),
    },
    tenant: {
      findMany: async ({ where }: { where: { id: { in: string[] } } }) =>
        opts.tenants.filter((t) => where.id.in.includes(t.id)),
    },
    withTenant: async <T>(
      tenantIds: string[],
      fn: (tx: {
        project: { findFirst: (args: { where: Where }) => Promise<FakeProject | null> };
      }) => Promise<T>,
    ): Promise<T> =>
      fn({
        project: {
          findFirst: async ({ where }) => {
            const visible = opts.projects.filter((p) =>
              tenantIds.includes(p.tenantId),
            );
            const [byId, byName] = where.OR;
            return (
              visible.find(
                (p) =>
                  p.userId === where.userId &&
                  p.tenantId === where.tenantId &&
                  (p.id === byId.id ||
                    p.name.toLowerCase() === byName.name.equals.toLowerCase()),
              ) ?? null
            );
          },
        },
      }),
  };

  return new CatalogService(
    prisma as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );
}

/** Cenário base: usuário membro só do tenant A, com um projeto nele. */
function baseService() {
  return makeService({
    memberships: [TENANT_A],
    tenants: [
      { id: TENANT_A, accountLogin: 'RodReis' },
      { id: TENANT_B, accountLogin: 'Outra' },
    ],
    projects: [
      { id: PROJ_A, name: 'rrb-proplan', tenantId: TENANT_A, userId: 'u1' },
    ],
  });
}

describe('resolveSlugs (SPEC-028)', () => {
  it('resolve slug → ids canônicos, com slugs em lowercase', async () => {
    const out = await baseService().resolveSlugs('u1', 'rodreis', 'rrb-proplan');

    expect(out).toEqual({
      tenantId: TENANT_A,
      projectId: PROJ_A,
      tenantSlug: 'rodreis',
      projectSlug: 'rrb-proplan',
    });
  });

  it('casa case-insensitive e canoniza para lowercase', async () => {
    const out = await baseService().resolveSlugs('u1', 'RodReis', 'RRB-ProPlan');

    expect(out.tenantId).toBe(TENANT_A);
    expect(out.projectId).toBe(PROJ_A);
    expect(out.tenantSlug).toBe('rodreis');
    expect(out.projectSlug).toBe('rrb-proplan');
  });

  it('é idempotente para UUID: bookmark antigo continua abrindo', async () => {
    const out = await baseService().resolveSlugs('u1', TENANT_A, PROJ_A);

    expect(out.tenantId).toBe(TENANT_A);
    expect(out.projectId).toBe(PROJ_A);
    // Mesmo entrando por UUID, a resposta carrega os slugs canônicos — é deles
    // que a app monta o `history.replace` para a URL bonita.
    expect(out.tenantSlug).toBe('rodreis');
    expect(out.projectSlug).toBe('rrb-proplan');
  });

  it('resolve por UUID mesmo depois de o repo ser renomeado (id é a identidade)', async () => {
    // Simula o rename: o `name` mudou no sync, o `id` não. A SPEC-028 fixa que
    // o slug é leitura e a identidade é o id estável — se este teste quebrar, o
    // slug virou identidade e o rename passou a derrubar bookmark.
    const service = makeService({
      memberships: [TENANT_A],
      tenants: [{ id: TENANT_A, accountLogin: 'RodReis' }],
      projects: [
        { id: PROJ_A, name: 'proplan-renomeado', tenantId: TENANT_A, userId: 'u1' },
      ],
    });

    const out = await service.resolveSlugs('u1', TENANT_A, PROJ_A);

    expect(out.projectId).toBe(PROJ_A);
    expect(out.projectSlug).toBe('proplan-renomeado');
    // O slug ANTIGO deixa de resolver — comportamento aceito (rename-redirect
    // está fora de escopo); o bookmark por UUID é o que sobrevive.
    await expect(
      service.resolveSlugs('u1', TENANT_A, 'rrb-proplan'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('tenant de que o usuário não é membro → 404, por slug e por UUID', async () => {
    const service = baseService();

    await expect(
      service.resolveSlugs('u1', 'outra', 'qualquer'),
    ).rejects.toBeInstanceOf(NotFoundException);
    // Nem forjando o UUID real do tenant alheio: ele não entra no universo de
    // busca, então o 404 é o mesmo de "não existe" (não-diferencial).
    await expect(
      service.resolveSlugs('u1', TENANT_B, 'qualquer'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('projeto inexistente sob tenant válido → 404', async () => {
    await expect(
      baseService().resolveSlugs('u1', 'rodreis', 'nao-existe'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('projeto de OUTRO tenant não resolve sob o tenant da URL', async () => {
    // Usuário é membro dos dois; ainda assim `/t/rodreis/p/<projeto-do-B>` não
    // pode resolver — o contexto aberto é o do tenant da URL, não o array todo.
    const service = makeService({
      memberships: [TENANT_A, TENANT_B],
      tenants: [
        { id: TENANT_A, accountLogin: 'RodReis' },
        { id: TENANT_B, accountLogin: 'Outra' },
      ],
      projects: [
        { id: PROJ_A, name: 'rrb-proplan', tenantId: TENANT_A, userId: 'u1' },
        { id: PROJ_B, name: 'so-do-b', tenantId: TENANT_B, userId: 'u1' },
      ],
    });

    await expect(
      service.resolveSlugs('u1', 'rodreis', 'so-do-b'),
    ).rejects.toBeInstanceOf(NotFoundException);
    // E o mesmo projeto resolve sob o tenant correto — prova que o 404 acima é
    // escopo, não projeto inexistente.
    await expect(service.resolveSlugs('u1', 'outra', 'so-do-b')).resolves.toMatchObject(
      { tenantId: TENANT_B, projectId: PROJ_B },
    );
  });

  it('usuário sem membership nenhum → 404 (fail-closed, nunca "todos")', async () => {
    const service = makeService({
      memberships: [],
      tenants: [{ id: TENANT_A, accountLogin: 'RodReis' }],
      projects: [
        { id: PROJ_A, name: 'rrb-proplan', tenantId: TENANT_A, userId: 'u1' },
      ],
    });

    await expect(
      service.resolveSlugs('u1', 'rodreis', 'rrb-proplan'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('token vazio → 404 (não casa "qualquer um")', async () => {
    const service = baseService();

    await expect(service.resolveSlugs('u1', '', 'rrb-proplan')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(service.resolveSlugs('u1', 'rodreis', '')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
