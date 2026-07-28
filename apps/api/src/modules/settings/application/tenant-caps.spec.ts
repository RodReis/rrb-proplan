/**
 * Teto de gasto de IA por tenant (ADR-026) — quem lê, quem escreve e de onde
 * vem o número.
 *
 * O critério de aceite da SPEC-032 é curto ("`member` não altera o teto"), mas
 * o defeito que o ADR corrige é mais fundo: o teto era resolvido a partir da
 * PESSOA. Estes casos travam as duas pontas — a chave usada e o papel exigido.
 */
import { ForbiddenException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { SettingsService } from './settings.service';

const D = (v: string | number) => new Prisma.Decimal(v);

function makePrisma(opts: {
  role?: 'owner' | 'member' | 'viewer' | null;
  alert?: string;
  hardCap?: string;
}) {
  const row = {
    llmAlertUsdMonthly: D(opts.alert ?? '5'),
    llmHardCapUsdMonthly: D(opts.hardCap ?? '20'),
  };
  const client: any = {
    membership: {
      // 1ª chamada = `personalTenantId` (resolve o tenant); as seguintes = a
      // checagem de papel. `role: null` simula quem tem tenant mas nenhum
      // membership NELE — o caso que a guarda precisa recusar por regra, e não
      // por acidente de `personalTenantId` lançar antes.
      findFirst: jest
        .fn()
        .mockResolvedValueOnce({ tenantId: 't1', role: opts.role ?? 'owner' })
        .mockResolvedValue(opts.role === null ? null : { tenantId: 't1', role: opts.role ?? 'owner' }),
    },
    tenantSettings: {
      upsert: jest.fn().mockResolvedValue(row),
    },
  };
  client.withTenant = jest.fn((_ids: string[], fn: (tx: any) => any) => fn(client));
  return client;
}

describe('SettingsService — teto do tenant (ADR-026)', () => {
  it('capsOf recebe tenantId e consulta tenant_settings por ele', async () => {
    const prisma = makePrisma({ hardCap: '42' });
    const svc = new SettingsService(prisma);

    const caps = await svc.capsOf('t1');

    expect(caps.hardCap.toString()).toBe('42');
    expect(prisma.tenantSettings.upsert).toHaveBeenCalledWith({
      where: { tenantId: 't1' },
      create: { tenantId: 't1' },
      update: {},
    });
  });

  it('capsOf abre o contexto do tenant — sem ele o RLS devolveria zero em silêncio', async () => {
    const prisma = makePrisma({});
    await new SettingsService(prisma).capsOf('t1');
    // Não é detalhe de implementação: ler `tenant_settings` sem contexto não dá
    // erro, cria uma linha nova com o DEFAULT e o gate passa a medir contra um
    // teto que ninguém configurou. 5 ocorrências desta classe nesta frente.
    expect(prisma.withTenant).toHaveBeenCalledWith(['t1'], expect.any(Function));
  });

  it('owner altera o teto', async () => {
    const prisma = makePrisma({ role: 'owner', hardCap: '30' });
    const svc = new SettingsService(prisma);

    const r = await svc.updateTenantCaps('u1', { llmHardCapUsdMonthly: '30' });

    expect(r.llmHardCapUsdMonthly).toBe('30');
    expect(prisma.tenantSettings.upsert).toHaveBeenCalled();
  });

  it('member NÃO altera o teto (critério de aceite da SPEC-032)', async () => {
    const prisma = makePrisma({ role: 'member' });
    const svc = new SettingsService(prisma);

    await expect(
      svc.updateTenantCaps('u1', { llmHardCapUsdMonthly: '999' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    // Recusar depois de gravar não seria recusar.
    expect(prisma.tenantSettings.upsert).not.toHaveBeenCalled();
  });

  it('viewer NÃO altera o teto', async () => {
    const prisma = makePrisma({ role: 'viewer' });
    await expect(
      new SettingsService(prisma).updateTenantCaps('u1', { llmAlertUsdMonthly: '1' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('sem membership no tenant → recusa (não assume owner)', async () => {
    const prisma = makePrisma({ role: null });
    await expect(
      new SettingsService(prisma).updateTenantCaps('u1', { llmAlertUsdMonthly: '1' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('teto negativo é recusado antes de chegar ao banco', async () => {
    const prisma = makePrisma({ role: 'owner' });
    await expect(
      new SettingsService(prisma).updateTenantCaps('u1', { llmHardCapUsdMonthly: '-1' }),
    ).rejects.toThrow(/>= 0/);
    expect(prisma.tenantSettings.upsert).not.toHaveBeenCalled();
  });

  it('tenantCaps diz à tela quem pode editar', async () => {
    expect((await new SettingsService(makePrisma({ role: 'owner' })).tenantCaps('u1')).canEditCaps).toBe(true);
    expect((await new SettingsService(makePrisma({ role: 'member' })).tenantCaps('u1')).canEditCaps).toBe(false);
  });
});
