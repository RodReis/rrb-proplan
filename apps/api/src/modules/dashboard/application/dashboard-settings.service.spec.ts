import { ForbiddenException, UnprocessableEntityException } from '@nestjs/common';
import { DashboardSettingsService } from './dashboard-settings.service';

const TENANT = 't1';

function prismaFake(stalledDays = 7): any {
  return {
    tenantSettings: {
      upsert: jest.fn().mockResolvedValue({ stalledDays }),
    },
  };
}

describe('DashboardSettingsService (SPEC-035 §6)', () => {
  describe('leitura', () => {
    it('cria a linha de settings se ainda não existir', async () => {
      // `upsert` e não `findUnique`: devolver "sem configuração" obrigaria cada
      // chamador a reimplementar o default — que é como um `7` literal volta a
      // se espalhar pelo código.
      const prisma = prismaFake();

      await new DashboardSettingsService(prisma).stalledDays(TENANT);

      expect(prisma.tenantSettings.upsert).toHaveBeenCalledWith({
        where: { tenantId: TENANT },
        create: { tenantId: TENANT },
        update: {},
        select: { stalledDays: true },
      });
    });

    it('devolve o valor configurado, não o default', async () => {
      const prisma = prismaFake(21);
      expect(await new DashboardSettingsService(prisma).stalledDays(TENANT)).toBe(21);
    });

    it('`canEdit` sai do papel resolvido no servidor', async () => {
      const svc = new DashboardSettingsService(prismaFake());
      expect((await svc.get(TENANT, 'owner')).canEdit).toBe(true);
      expect((await svc.get(TENANT, 'member')).canEdit).toBe(false);
      expect((await svc.get(TENANT, undefined)).canEdit).toBe(false);
    });
  });

  describe('escrita — só o owner (ADR-026)', () => {
    it('member recebe 403 e nada é gravado', async () => {
      const prisma = prismaFake();

      await expect(
        new DashboardSettingsService(prisma).update(TENANT, 'member', 14),
      ).rejects.toThrow(ForbiddenException);
      expect(prisma.tenantSettings.upsert).not.toHaveBeenCalled();
    });

    it('viewer e sem papel também são recusados', async () => {
      const svc = new DashboardSettingsService(prismaFake());
      await expect(svc.update(TENANT, 'viewer', 14)).rejects.toThrow(ForbiddenException);
      await expect(svc.update(TENANT, undefined, 14)).rejects.toThrow(ForbiddenException);
    });

    it('owner grava o valor novo', async () => {
      const prisma = prismaFake();

      const out = await new DashboardSettingsService(prisma).update(TENANT, 'owner', 14);

      expect(out).toEqual({ stalledDays: 14, canEdit: true });
      expect(prisma.tenantSettings.upsert).toHaveBeenCalledWith({
        where: { tenantId: TENANT },
        create: { tenantId: TENANT, stalledDays: 14 },
        update: { stalledDays: 14 },
      });
    });
  });

  describe('validação — o que chega errado não entra', () => {
    it('recusa zero, negativo, fracionado e absurdo', async () => {
      const svc = new DashboardSettingsService(prismaFake());
      for (const valor of [0, -1, 1.5, 366, Number.NaN]) {
        await expect(svc.update(TENANT, 'owner', valor)).rejects.toThrow(
          UnprocessableEntityException,
        );
      }
    });

    it('aceita as bordas da faixa', async () => {
      const svc = new DashboardSettingsService(prismaFake());
      await expect(svc.update(TENANT, 'owner', 1)).resolves.toBeDefined();
      await expect(svc.update(TENANT, 'owner', 365)).resolves.toBeDefined();
    });
  });
});
