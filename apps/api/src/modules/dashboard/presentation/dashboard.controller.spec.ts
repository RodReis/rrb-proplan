import { BadRequestException } from '@nestjs/common';
import { DashboardController } from './dashboard.controller';

const TENANT = 't1';

function make(over: Record<string, any> = {}) {
  const dashboard: any = {
    view: jest.fn().mockResolvedValue({}),
    pendingCount: jest.fn().mockResolvedValue({ count: 0 }),
  };
  const settings: any = {
    get: jest.fn().mockResolvedValue({ stalledDays: 7, canEdit: false }),
    update: jest.fn().mockResolvedValue({ stalledDays: 14, canEdit: true }),
  };
  Object.assign(dashboard, over.dashboard);
  Object.assign(settings, over.settings);
  return { ctrl: new DashboardController(dashboard, settings), dashboard, settings };
}

const req = (role?: string): any => ({ tenantId: TENANT, role, userId: 'u1' });

describe('DashboardController (SPEC-035 §6)', () => {
  describe('o período é lista fechada — fora dela é RECUSA, não correção', () => {
    it('sem parâmetro usa o padrão 30', async () => {
      const { ctrl, dashboard } = make();

      await ctrl.view(req(), undefined);

      expect(dashboard.view).toHaveBeenCalledWith(TENANT, '30', expect.any(Date));
    });

    it('aceita os 4 valores da lista', async () => {
      const { ctrl, dashboard } = make();

      for (const p of ['7', '30', '90', 'current_month']) {
        await ctrl.view(req(), p);
        expect(dashboard.view).toHaveBeenLastCalledWith(TENANT, p, expect.any(Date));
      }
    });

    it('valor fora da lista → 400, e a consulta NÃO acontece', async () => {
      // Corrigir em silêncio para o padrão faria um erro de front virar dado
      // errado em tela: a contagem apareceria plausível, de uma janela que
      // ninguém pediu (§6).
      const { ctrl, dashboard } = make();

      await expect(ctrl.view(req(), '60')).rejects.toThrow(BadRequestException);
      await expect(ctrl.view(req(), 'ontem')).rejects.toThrow(BadRequestException);
      expect(dashboard.view).not.toHaveBeenCalled();
    });
  });

  describe('o contador tem rota própria, mas o mesmo caminho de dado (§2.3)', () => {
    it('não recebe período — *Esperando você* é estado corrente, não janela', async () => {
      const { ctrl, dashboard } = make();

      await ctrl.pendingCount(req());

      expect(dashboard.pendingCount).toHaveBeenCalledWith(TENANT, expect.any(Date));
      expect(dashboard.view).not.toHaveBeenCalled();
    });
  });

  describe('o tenant vem do guard, nunca do corpo (ADR-020, regra 1)', () => {
    it('todas as rotas usam `req.tenantId`', async () => {
      const { ctrl, dashboard, settings } = make();

      await ctrl.view(req('owner'), '30');
      await ctrl.pendingCount(req('owner'));
      await ctrl.getSettings(req('owner'));
      await ctrl.updateSettings(req('owner'), { stalledDays: 14 });

      expect(dashboard.view.mock.calls[0][0]).toBe(TENANT);
      expect(dashboard.pendingCount.mock.calls[0][0]).toBe(TENANT);
      expect(settings.get.mock.calls[0][0]).toBe(TENANT);
      expect(settings.update.mock.calls[0][0]).toBe(TENANT);
    });

    it('o papel também vem do guard e é repassado ao service, que decide', async () => {
      const { ctrl, settings } = make();

      await ctrl.updateSettings(req('member'), { stalledDays: 14 });

      // A guarda de `owner` vive no service (ADR-026) — o controller não a
      // duplica, senão as duas divergiriam na primeira mudança.
      expect(settings.update).toHaveBeenCalledWith(TENANT, 'member', 14);
    });
  });

  describe('settings: o corpo é normalizado antes de descer', () => {
    it('valor não-numérico vira NaN e o service o recusa', async () => {
      const { ctrl, settings } = make();

      await ctrl.updateSettings(req('owner'), { stalledDays: 'sete' });

      expect(settings.update).toHaveBeenCalledWith(TENANT, 'owner', Number.NaN);
    });
  });
});
