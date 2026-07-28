import type { PrismaService } from '../../../prisma/prisma.service';
import { hashToken } from '../domain/contract-token';
import { ContractLinkService } from './contract-link.service';

const CONTRATO = {
  id: 'ctr-1',
  tenantId: 't-1',
  clientProjectId: 'cp-1',
  version: 1,
  renderedHtml: '<p>contrato</p>',
};

interface LinhaLink {
  id: string;
  contractId: string;
  tokenHash: string;
  expiresAt: Date;
  revokedAt: Date | null;
  createdAt: Date;
}

/**
 * Dobra do Prisma. `resolvido` é o que a `resolve_contract_link` devolveria —
 * a função é SQL, então aqui o que se testa é a REGRA em volta dela: o que o
 * service faz com a linha que ela devolve (ou com a ausência dela).
 */
function montar(opcoes: {
  contrato?: typeof CONTRATO | null;
  links?: LinhaLink[];
  resolvido?: Array<Record<string, unknown>>;
} = {}) {
  const links = opcoes.links ?? [];
  const auditados: Array<Record<string, unknown>> = [];
  let seq = 0;

  const prisma = {
    contract: {
      findFirst: jest.fn(async () =>
        opcoes.contrato === undefined ? CONTRATO : opcoes.contrato,
      ),
      findUnique: jest.fn(async () =>
        opcoes.contrato === undefined ? CONTRATO : opcoes.contrato,
      ),
    },
    contractLink: {
      updateMany: jest.fn(async ({ data }: { data: { revokedAt: Date } }) => {
        const ativos = links.filter((l) => l.revokedAt === null);
        ativos.forEach((l) => (l.revokedAt = data.revokedAt));
        return { count: ativos.length };
      }),
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const linha: LinhaLink = {
          id: `link-${++seq}`,
          contractId: data.contractId as string,
          tokenHash: data.tokenHash as string,
          expiresAt: data.expiresAt as Date,
          revokedAt: null,
          createdAt: new Date('2026-07-28T12:00:00Z'),
        };
        links.push(linha);
        return linha;
      }),
      findFirst: jest.fn(async () =>
        links.filter((l) => l.revokedAt === null).at(-1) ?? null,
      ),
    },
    auditEvent: {
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        auditados.push(data);
        return data;
      }),
    },
    $queryRaw: jest.fn(async () => opcoes.resolvido ?? []),
    $transaction: jest.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
      fn(prisma),
    ),
    runInTenantContext: jest.fn(
      async (_ids: string[], fn: () => Promise<unknown>) => fn(),
    ),
  } as unknown as PrismaService;

  return { service: new ContractLinkService(prisma), prisma, links, auditados };
}

describe('ContractLinkService: gerar o link (§2.8)', () => {
  it('devolve o token em claro uma única vez e persiste só o hash', async () => {
    const { service, links } = montar();
    const criado = await service.createOrRegenerate('t-1', 'ctr-1');

    expect(criado.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(links).toHaveLength(1);
    expect(links[0].tokenHash).toBe(hashToken(criado.token));
    // O token em claro não pode ter sido gravado em lugar nenhum.
    expect(links[0].tokenHash).not.toBe(criado.token);
  });

  it('o link nasce com prazo de 48 h — nunca sem prazo', async () => {
    const { service, links } = montar();
    const antes = Date.now();
    await service.createOrRegenerate('t-1', 'ctr-1');

    const ttl = links[0].expiresAt.getTime() - antes;
    // Folga de 5 s para o tempo de execução do teste.
    expect(ttl).toBeGreaterThan(48 * 60 * 60 * 1000 - 5_000);
    expect(ttl).toBeLessThanOrEqual(48 * 60 * 60 * 1000);
  });

  /**
   * Dois links vivos para o mesmo contrato significaria que revogar um não
   * fecha o acesso — que é o oposto do que "revogar" promete (§2.8).
   */
  it('regenerar revoga o anterior — nunca dois links vivos', async () => {
    const { service, links } = montar();
    await service.createOrRegenerate('t-1', 'ctr-1');
    await service.createOrRegenerate('t-1', 'ctr-1');

    expect(links).toHaveLength(2);
    expect(links[0].revokedAt).not.toBeNull();
    expect(links.filter((l) => l.revokedAt === null)).toHaveLength(1);
  });

  it('recusa contrato de outro tenant sem dizer que ele existe', async () => {
    const { service, links } = montar({ contrato: null });
    await expect(service.createOrRegenerate('t-1', 'ctr-alheio')).rejects.toThrow(
      /não encontrado/,
    );
    expect(links).toHaveLength(0);
  });

  it('audita a criação sem registrar o token', async () => {
    const { service, auditados } = montar();
    const criado = await service.createOrRegenerate('t-1', 'ctr-1');

    const evento = auditados.find((a) => a.kind === 'contract_link.created');
    expect(evento).toBeDefined();
    expect(JSON.stringify(evento)).not.toContain(criado.token);
  });
});

describe('ContractLinkService: revogar (§2.8, efeito imediato)', () => {
  it('revoga o link ativo e informa quantos', async () => {
    const { service, links } = montar();
    await service.createOrRegenerate('t-1', 'ctr-1');

    const resultado = await service.revoke('t-1', 'ctr-1');
    expect(resultado).toEqual({ revoked: 1 });
    expect(links[0].revokedAt).not.toBeNull();
  });

  it('revogar sem link ativo não explode — é idempotente', async () => {
    const { service } = montar();
    await expect(service.revoke('t-1', 'ctr-1')).resolves.toEqual({ revoked: 0 });
  });

  it('recusa revogar contrato alheio', async () => {
    const { service } = montar({ contrato: null });
    await expect(service.revoke('t-1', 'ctr-alheio')).rejects.toThrow(
      /não encontrado/,
    );
  });
});

describe('ContractLinkService: metadados do link no painel', () => {
  it('devolve estado sem nunca devolver o token (que não é recuperável)', async () => {
    const { service } = montar();
    const criado = await service.createOrRegenerate('t-1', 'ctr-1');
    const ativo = await service.getActive('t-1', 'ctr-1');

    expect(ativo.active).toBe(true);
    expect(JSON.stringify(ativo)).not.toContain(criado.token);
    expect(ativo).toMatchObject({ status: 'valid' });
  });

  it('sem link, diz que não há — não inventa um', async () => {
    const { service } = montar();
    await expect(service.getActive('t-1', 'ctr-1')).resolves.toEqual({
      active: false,
    });
  });
});

describe('ContractLinkService: resolução pública, não-diferencial (§5)', () => {
  const LINHA_VALIDA = {
    id: 'link-1',
    expires_at: new Date('2099-01-01T00:00:00Z'),
    revoked_at: null,
    tenant_id: 't-1',
    contract_id: 'ctr-1',
    client_project_id: 'cp-1',
  };

  it('token válido devolve o contrato renderizado', async () => {
    const { service } = montar({ resolvido: [LINHA_VALIDA] });
    const resposta = await service.resolvePublic('token-qualquer');

    expect(resposta.status).toBe('valid');
    expect(resposta.contract?.renderedHtml).toBe('<p>contrato</p>');
  });

  /**
   * O caso que a função `resolve_contract_link` existe para cobrir: a rota
   * pública roda SEM contexto de tenant, e o RLS é fail-closed. Um SELECT
   * direto devolveria vazio para TODO token, inclusive os válidos.
   */
  it('lê o contrato sob o contexto do tenant descoberto pelo hash', async () => {
    const { service, prisma } = montar({ resolvido: [LINHA_VALIDA] });
    await service.resolvePublic('token-qualquer');

    expect(prisma.runInTenantContext).toHaveBeenCalledWith(
      ['t-1'],
      expect.any(Function),
    );
  });

  it.each([
    ['inexistente', [] as Array<Record<string, unknown>>, 'invalid'],
    [
      'revogado',
      [{ ...LINHA_VALIDA, revoked_at: new Date('2026-07-28T10:00:00Z') }],
      'revoked',
    ],
    [
      'expirado',
      [{ ...LINHA_VALIDA, expires_at: new Date('2020-01-01T00:00:00Z') }],
      'expired',
    ],
  ])('token %s devolve `%s` sem corpo de contrato', async (_nome, linhas, esperado) => {
    const { service } = montar({ resolvido: linhas });
    const resposta = await service.resolvePublic('token-qualquer');

    expect(resposta.status).toBe(esperado);
    expect(resposta.contract).toBeUndefined();
  });

  /**
   * Não-diferencial: quem sonda token não pode aprender NADA além de "este não
   * serve". Nenhuma das respostas inválidas pode citar tenant, cliente ou
   * projeto.
   */
  it.each([
    ['inexistente', [] as Array<Record<string, unknown>>],
    ['revogado', [{ ...LINHA_VALIDA, revoked_at: new Date('2026-07-28T10:00:00Z') }]],
    ['expirado', [{ ...LINHA_VALIDA, expires_at: new Date('2020-01-01T00:00:00Z') }]],
  ])('a resposta de token %s não vaza tenant, projeto nem contrato', async (_n, linhas) => {
    const { service } = montar({ resolvido: linhas });
    const serializada = JSON.stringify(
      await service.resolvePublic('token-qualquer'),
    );

    expect(serializada).not.toContain('t-1');
    expect(serializada).not.toContain('cp-1');
    expect(serializada).not.toContain('ctr-1');
    expect(serializada).not.toContain('link-1');
  });

  /**
   * §2.11: auditado, mas SEM IP e SEM user agent. Guardar IP seria coletar mais
   * dado pessoal na fatia cujo problema é justamente excesso de dado pessoal.
   * Provado por AUSÊNCIA — o padrão do §7.1 da SPEC-032.
   */
  it('grava o acesso sem IP e sem user agent', async () => {
    const { service, auditados } = montar({ resolvido: [LINHA_VALIDA] });
    await service.resolvePublic('token-qualquer');

    const evento = auditados.find((a) => a.kind === 'contract_link.accessed');
    expect(evento).toBeDefined();

    const serializado = JSON.stringify(evento).toLowerCase();
    for (const proibido of ['ip', 'useragent', 'user_agent', 'user-agent']) {
      expect(serializado).not.toContain(proibido);
    }
  });

  it('não audita token inexistente sob tenant nenhum — não há tenant a descobrir', async () => {
    const { service, auditados } = montar({ resolvido: [] });
    await service.resolvePublic('token-qualquer');
    expect(auditados).toHaveLength(0);
  });

  it('o acesso a link revogado também é auditado', async () => {
    const { service, auditados } = montar({
      resolvido: [{ ...LINHA_VALIDA, revoked_at: new Date('2026-07-28T10:00:00Z') }],
    });
    await service.resolvePublic('token-qualquer');

    expect(auditados.find((a) => a.kind === 'contract_link.accessed')).toMatchObject(
      { payload: expect.objectContaining({ status: 'revoked' }) },
    );
  });
});
