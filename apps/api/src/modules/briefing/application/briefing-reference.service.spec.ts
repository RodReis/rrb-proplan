import { NotFoundException } from '@nestjs/common';
import { BriefingReferenceService } from './briefing-reference.service';

/**
 * Referência da Etapa 1 (SPEC-031 §3).
 *
 * O que estes testes protegem:
 *
 *   - **catálogo é do tenant do link**, e sai sob `runInTenantContext` — sem o
 *     contexto o RLS fail-closed devolveria lista vazia em silêncio (foi assim
 *     que o card ficou parado no PR-2);
 *   - **não-diferencial**: link inexistente, revogado e expirado respondem o
 *     mesmo 404 — a rota não pode virar oráculo de tokens que já existiram;
 *   - as listas do Brasil (segmentos/estados/cidades) saem **sem** tenant no
 *     contexto, que é o motivo de elas não terem RLS.
 */

const TENANT = '00000000-0000-4000-8000-00000000000a';

function row(over: Record<string, unknown> = {}) {
  return { tenant_id: TENANT, expires_at: null, revoked_at: null, ...over };
}

function prismaFake(rows: unknown[] = [row()]): any {
  return {
    $queryRaw: jest.fn().mockResolvedValue(rows),
    segment: {
      findMany: jest
        .fn()
        .mockResolvedValue([{ code: 'comercio', label: 'Comércio' }]),
    },
    state: {
      findMany: jest.fn().mockResolvedValue([{ code: 'SP', name: 'São Paulo' }]),
    },
    city: {
      findMany: jest
        .fn()
        .mockResolvedValue([{ ibgeId: 3550308, name: 'São Paulo' }]),
    },
    serviceCatalogItem: {
      findMany: jest.fn().mockResolvedValue([
        { segment: 'comercio', label: 'Loja virtual' },
        { segment: 'comercio', label: 'Catálogo online' },
        { segment: 'servicos', label: 'Agendamento' },
      ]),
    },
    runInTenantContext: jest.fn(
      async (_ids: string[], fn: () => Promise<unknown>) => fn(),
    ),
  };
}

describe('BriefingReferenceService (SPEC-031)', () => {
  describe('catálogo', () => {
    it('devolve segmentos e estados como pares value/label', async () => {
      const svc = new BriefingReferenceService(prismaFake());
      const out = await svc.getCatalog('tok');

      expect(out.segments).toEqual([{ value: 'comercio', label: 'Comércio' }]);
      expect(out.states).toEqual([{ value: 'SP', label: 'São Paulo' }]);
    });

    it('agrupa o catálogo por segmento — a Etapa 1 filtra pelo que foi escolhido', async () => {
      const svc = new BriefingReferenceService(prismaFake());
      const out = await svc.getCatalog('tok');

      expect(out.services).toEqual({
        comercio: ['Loja virtual', 'Catálogo online'],
        servicos: ['Agendamento'],
      });
    });

    it('lê o catálogo DENTRO do contexto do tenant do link', async () => {
      const prisma = prismaFake();
      const svc = new BriefingReferenceService(prisma);
      await svc.getCatalog('tok');

      expect(prisma.runInTenantContext).toHaveBeenCalledWith(
        [TENANT],
        expect.any(Function),
      );
      // O tenant sai do hash do token, nunca de nada que venha no request.
      expect(prisma.serviceCatalogItem.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { tenantId: TENANT, active: true } }),
      );
    });

    it('tenant sem catálogo devolve mapa vazio, não erro — ausência é informação', async () => {
      const prisma = prismaFake();
      prisma.serviceCatalogItem.findMany.mockResolvedValue([]);
      const svc = new BriefingReferenceService(prisma);

      expect((await svc.getCatalog('tok')).services).toEqual({});
    });
  });

  describe('cidades', () => {
    it('filtra pelo estado escolhido e devolve o código IBGE como valor', async () => {
      const prisma = prismaFake();
      const svc = new BriefingReferenceService(prisma);
      const out = await svc.getCities('tok', 'sp');

      // Normaliza para maiúscula: a UF é gravada 'SP' e o cliente pode mandar
      // o que a URL trouxer.
      expect(prisma.city.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { state: { code: 'SP' } } }),
      );
      expect(out).toEqual([{ value: '3550308', label: 'São Paulo' }]);
    });

    it('não abre contexto de tenant — cidade é lista do Brasil, tabela sem RLS', async () => {
      const prisma = prismaFake();
      const svc = new BriefingReferenceService(prisma);
      await svc.getCities('tok', 'SP');

      expect(prisma.runInTenantContext).not.toHaveBeenCalled();
    });
  });

  describe('não-diferencial', () => {
    it.each([
      ['inexistente', []],
      ['revogado', [row({ revoked_at: new Date('2020-01-01') })]],
      ['expirado', [row({ expires_at: new Date('2020-01-01') })]],
    ])('link %s responde 404 igual nas duas rotas', async (_caso, rows) => {
      const svc = new BriefingReferenceService(prismaFake(rows));

      await expect(svc.getCatalog('tok')).rejects.toBeInstanceOf(NotFoundException);
      await expect(svc.getCities('tok', 'SP')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('link morto não vaza o catálogo do tenant', async () => {
      const prisma = prismaFake([row({ revoked_at: new Date('2020-01-01') })]);
      const svc = new BriefingReferenceService(prisma);

      await expect(svc.getCatalog('tok')).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.serviceCatalogItem.findMany).not.toHaveBeenCalled();
    });
  });
});
