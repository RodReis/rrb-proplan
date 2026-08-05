import { LicenseExpirySweepService } from './license-expiry-sweep.service';
import type { PrismaService } from '../../../prisma/prisma.service';

/**
 * O que estes testes protegem: o job **materializa**, não decide. O filtro é
 * tudo o que ele tem — e dois erros nele são invisíveis em produção:
 *
 * - varrer `expiresAt: null` marcaria toda licença **PERPETUAL** como expirada
 *   (o cliente que pagou uma vez perde acesso, e o admin vê `EXPIRED` correto na
 *   tela sobre uma licença que nunca expira);
 * - rodar fora de `runInTenantContext` afetaria zero linhas sem erro, e o job
 *   reportaria sucesso tendo feito nada.
 */
describe('LicenseExpirySweepService', () => {
  function montar(count = 0) {
    const updateMany = jest.fn().mockResolvedValue({ count });
    // Dobrado para o teste provar que **não** é chamado: a enumeração passa pela
    // função `SECURITY DEFINER` (ADR-030), não por leitura direta.
    const findMany = jest.fn().mockResolvedValue([{ tenantId: 'tn-1' }, { tenantId: 'tn-2' }]);
    const sqlCapturado: string[] = [];
    const queryRaw = jest.fn(async (frag: TemplateStringsArray) => {
      sqlCapturado.push(frag.join('?'));
      return [{ tenant_id: 'tn-1' }, { tenant_id: 'tn-2' }];
    });
    const prisma = {
      license: { updateMany, findMany },
      $queryRaw: queryRaw,
      // Repassa o callback, mas registra que foi chamado: rodar FORA do
      // contexto é o modo silencioso de falhar.
      runInTenantContext: jest.fn((_ids: string[], fn: () => unknown) => fn()),
    } as unknown as PrismaService;
    return {
      prisma,
      updateMany,
      findMany,
      service: new LicenseExpirySweepService(prisma),
      get sqlEnumeracao() {
        return sqlCapturado.join(' | ');
      },
    };
  }

  it('marca EXPIRED só o que já venceu e está ACTIVE', async () => {
    const { service, updateMany } = montar(3);

    const n = await service.sweep('tenant-1');

    expect(n).toBe(3);
    const where = updateMany.mock.calls[0][0].where;
    expect(where.status).toBe('ACTIVE');
    expect(where.expiresAt.lt).toBeInstanceOf(Date);
    expect(updateMany.mock.calls[0][0].data).toEqual({ status: 'EXPIRED' });
  });

  /**
   * PERPETUAL tem `expiresAt` nulo. Se o filtro deixar NULL entrar, o job
   * expira quem comprou vitalício — e a tela do admin mostraria o erro como se
   * fosse fato.
   */
  it('NUNCA varre licença perpétua (expiresAt nulo)', async () => {
    const { service, updateMany } = montar();

    await service.sweep('tenant-1');

    expect(updateMany.mock.calls[0][0].where.expiresAt.not).toBeNull();
  });

  /** Fora do contexto o RLS fail-closed afeta zero linhas, sem erro. */
  it('roda sob contexto do tenant', async () => {
    const { service, prisma } = montar();

    await service.sweep('tenant-42');

    expect(prisma.runInTenantContext).toHaveBeenCalledWith(
      ['tenant-42'],
      expect.any(Function),
    );
  });

  it('devolve zero no dia em que nada venceu', async () => {
    const { service } = montar(0);
    await expect(service.sweep('tenant-1')).resolves.toBe(0);
  });

  /**
   * A varredura de tenants da rodada diária (SPEC-048).
   *
   * **Sem filtro de credencial**, ao contrário dos outros dois jobs da fila. O
   * sweep não fala com ninguém de fora: condicioná-lo a Kiwify ou a PAT deixaria
   * licença vencida como `ACTIVE` na tela de todo tenant sem aquela credencial —
   * exatamente o desencontro que este job existe para fechar.
   */
  it('enumera pela função `SECURITY DEFINER`, nunca por leitura direta', async () => {
    const c = montar();

    const tenants = await c.service.tenantsComLicenca();

    // **O que este teste NÃO prova é o ponto** (ADR-030): mock de Prisma não tem
    // RLS, então nenhum unitário distingue a função da leitura direta pelo
    // efeito — foi assim que o defeito atravessou a Fatia 36 inteira. Aqui se
    // afirma a FORMA; o efeito é do
    // `licensing-tenant-enumeration.int-spec.ts`, contra Postgres real.
    expect(c.sqlEnumeracao).toMatch(/lic_tenants_with_expiring_licenses\(\)/);
    expect(c.findMany).not.toHaveBeenCalled();
    expect(tenants).toEqual(['tn-1', 'tn-2']);
  });
});
