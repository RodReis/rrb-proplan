import { NotFoundException } from '@nestjs/common';
import { transactionMock } from '../../../../test/prisma-transaction-mock';
import { hashToken } from '../domain/briefing-token';
import { BriefingLinkService } from './briefing-link.service';

const TENANT = 't1';
const PROJECT = 'cp1';

function prismaFake(over: Record<string, unknown> = {}): any {
  const prisma: any = {
    clientProject: {
      // Por padrão o projeto existe e é do tenant.
      findFirst: jest.fn().mockResolvedValue({ id: PROJECT }),
    },
    briefingLink: {
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({ id: 'bl1', expiresAt: null }),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    auditEvent: { create: jest.fn().mockResolvedValue({}) },
    $queryRaw: jest.fn().mockResolvedValue([]),
    $transaction: transactionMock(() => prisma),
    runInTenantContext: jest.fn((_ids: string[], fn: () => Promise<unknown>) => fn()),
    ...over,
  };
  return prisma;
}

describe('BriefingLinkService (SPEC-029)', () => {
  describe('criação', () => {
    it('devolve o token em claro mas persiste SÓ o hash', async () => {
      const prisma = prismaFake();
      const svc = new BriefingLinkService(prisma);

      const out = await svc.createOrRegenerate(TENANT, PROJECT);

      const persisted = prisma.briefingLink.create.mock.calls[0][0].data;
      // Critério de aceite: nenhuma coluna contém o token em claro.
      expect(persisted.tokenHash).toBe(hashToken(out.token));
      expect(JSON.stringify(persisted)).not.toContain(out.token);
    });

    it('o token não vaza para a auditoria', async () => {
      const prisma = prismaFake();
      const svc = new BriefingLinkService(prisma);

      const out = await svc.createOrRegenerate(TENANT, PROJECT);

      const audited = JSON.stringify(prisma.auditEvent.create.mock.calls);
      expect(audited).not.toContain(out.token);
      expect(audited).toContain('briefing_link.created');
    });

    it('regenerar revoga o anterior na MESMA transação interativa', async () => {
      const prisma = prismaFake();
      const svc = new BriefingLinkService(prisma);

      await svc.createOrRegenerate(TENANT, PROJECT);

      // Dois links vivos significaria que revogar um não fecha o acesso.
      expect(prisma.briefingLink.updateMany).toHaveBeenCalledWith({
        where: { clientProjectId: PROJECT, revokedAt: null },
        data: { revokedAt: expect.any(Date) },
      });
      expect(typeof prisma.$transaction.mock.calls[0][0]).toBe('function');
    });

    it('projeto de outro tenant → 404, sem criar nada', async () => {
      const prisma = prismaFake();
      prisma.clientProject.findFirst.mockResolvedValue(null);
      const svc = new BriefingLinkService(prisma);

      await expect(
        svc.createOrRegenerate(TENANT, 'alheio'),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.briefingLink.create).not.toHaveBeenCalled();
    });

    it('cada geração produz token diferente', async () => {
      const prisma = prismaFake();
      const svc = new BriefingLinkService(prisma);

      const a = await svc.createOrRegenerate(TENANT, PROJECT);
      const b = await svc.createOrRegenerate(TENANT, PROJECT);
      expect(a.token).not.toBe(b.token);
    });
  });

  describe('rota pública — não-diferencial', () => {
    const row = {
      id: 'bl1',
      expires_at: null,
      revoked_at: null,
      tenant_id: TENANT,
      client_project_id: PROJECT,
    };

    it('token válido → valid, e o acesso é auditado sob o tenant do HASH', async () => {
      const prisma = prismaFake();
      prisma.$queryRaw.mockResolvedValue([row]);
      const svc = new BriefingLinkService(prisma);

      expect(await svc.resolvePublic('tok')).toEqual({ status: 'valid' });
      // O tenant veio do lookup por hash, não de nada no request (ADR-020).
      expect(prisma.runInTenantContext).toHaveBeenCalledWith(
        [TENANT],
        expect.any(Function),
      );
      expect(prisma.auditEvent.create.mock.calls[0][0].data).toMatchObject({
        tenantId: TENANT,
        kind: 'briefing_link.accessed',
      });
    });

    it('token inexistente → invalid, sem vazar nada nem auditar', async () => {
      const prisma = prismaFake(); // $queryRaw devolve []
      const svc = new BriefingLinkService(prisma);

      expect(await svc.resolvePublic('naoexiste')).toEqual({ status: 'invalid' });
      expect(prisma.auditEvent.create).not.toHaveBeenCalled();
    });

    it('revogado e expirado respondem o próprio estado, sem vazar tenant/projeto', async () => {
      const prisma = prismaFake();
      prisma.$queryRaw.mockResolvedValue([
        { ...row, revoked_at: new Date('2026-07-01') },
      ]);
      const svc = new BriefingLinkService(prisma);
      const revoked = await svc.resolvePublic('tok');

      prisma.$queryRaw.mockResolvedValue([
        { ...row, expires_at: new Date('2026-07-01') },
      ]);
      const expired = await svc.resolvePublic('tok');

      expect(revoked).toEqual({ status: 'revoked' });
      expect(expired).toEqual({ status: 'expired' });
      // A resposta tem UMA chave só: nada de tenant, projeto, cliente ou id.
      expect(Object.keys(revoked)).toEqual(['status']);
      expect(Object.keys(expired)).toEqual(['status']);
    });

    it('o lookup filtra cliente/projeto excluído logicamente', async () => {
      const prisma = prismaFake();
      const svc = new BriefingLinkService(prisma);
      await svc.resolvePublic('tok');

      // Excluir o cliente tem de matar o link público junto — senão a exclusão
      // lógica deixaria uma porta aberta.
      const sql = prisma.$queryRaw.mock.calls[0][0].join('?');
      expect(sql).toContain('cp.deleted_at IS NULL');
      expect(sql).toContain('c.deleted_at IS NULL');
    });

    it('busca pelo HASH do token, nunca pelo token em claro', async () => {
      const prisma = prismaFake();
      const svc = new BriefingLinkService(prisma);
      await svc.resolvePublic('segredo');

      const params = prisma.$queryRaw.mock.calls[0].slice(1);
      expect(params).toContain(hashToken('segredo'));
      expect(params).not.toContain('segredo');
    });
  });

  describe('revogação e expiração', () => {
    it('revoke fecha todos os links ativos do projeto', async () => {
      const prisma = prismaFake();
      const svc = new BriefingLinkService(prisma);

      expect(await svc.revoke(TENANT, PROJECT)).toEqual({ revoked: 1 });
      expect(prisma.briefingLink.updateMany).toHaveBeenCalledWith({
        where: { clientProjectId: PROJECT, revokedAt: null },
        data: { revokedAt: expect.any(Date) },
      });
    });

    it('setExpiration sem link ativo → 404', async () => {
      const prisma = prismaFake();
      prisma.briefingLink.updateMany.mockResolvedValue({ count: 0 });
      const svc = new BriefingLinkService(prisma);

      await expect(
        svc.setExpiration(TENANT, PROJECT, new Date()),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('getActive nunca devolve o token (não é recuperável por design)', async () => {
      const prisma = prismaFake();
      prisma.briefingLink.findFirst.mockResolvedValue({
        id: 'bl1',
        expiresAt: null,
        createdAt: new Date(),
      });
      const svc = new BriefingLinkService(prisma);

      const out = await svc.getActive(TENANT, PROJECT);
      expect(out).toMatchObject({ active: true, status: 'valid' });
      expect(JSON.stringify(out)).not.toContain('token');
      // O select não pode nem pedir o hash.
      expect(
        prisma.briefingLink.findFirst.mock.calls[0][0].select,
      ).not.toHaveProperty('tokenHash');
    });

    it('sem link ativo, getActive responde active:false', async () => {
      const prisma = prismaFake();
      const svc = new BriefingLinkService(prisma);
      expect(await svc.getActive(TENANT, PROJECT)).toEqual({ active: false });
    });
  });
});
