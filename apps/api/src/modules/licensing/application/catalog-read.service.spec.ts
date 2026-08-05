import { CatalogReadService } from './catalog-read.service';
import { NUNCA_SINCRONIZOU } from './catalog-sync.service';
import type { PrismaService } from '../../../prisma/prisma.service';
import type { LicensingOpsService } from './licensing-ops.service';

/**
 * A leitura do catálogo (SPEC-047).
 *
 * A regra de quais ofertas entram é da função pura (`catalog-offers.spec.ts`);
 * o que se testa aqui é o que **só o service faz**: ler o snapshot sem chamar a
 * Kiwify, traduzir a época em `null`, e não quebrar com um payload de formato
 * inesperado — que é o nosso próprio passado, não um invasor.
 */
const RETRATO = new Date('2026-08-05T03:00:00Z');

function montar(over: { snapshot?: unknown; mapeamentos?: unknown[]; vistas?: unknown[] } = {}) {
  const prisma = {
    licCatalogSnapshot: {
      findUnique: jest.fn().mockResolvedValue(
        over.snapshot === undefined
          ? {
              payload: {
                produtos: [
                  { id: 'p1', name: 'War Room', offers: [{ id: 'o1', name: 'Sem fonte' }] },
                ],
              },
              fetchedAt: RETRATO,
              fetchError: null,
            }
          : over.snapshot,
      ),
    },
    licOfferMapping: {
      findMany: jest.fn().mockResolvedValue(over.mapeamentos ?? []),
    },
  } as unknown as PrismaService;

  const ops = {
    listSeenOffers: jest.fn().mockResolvedValue(over.vistas ?? []),
  } as unknown as LicensingOpsService;

  return { service: new CatalogReadService(prisma, ops), prisma, ops };
}

describe('CatalogReadService', () => {
  it('lista a oferta do snapshot com nome de produto e de oferta', async () => {
    const { service } = montar();

    const r = await service.catalogo('t-1');

    expect(r.fetchedAt).toEqual(RETRATO);
    expect(r.fetchError).toBeNull();
    expect(r.ofertas).toEqual([
      {
        externalProductId: 'p1',
        productName: 'War Room',
        externalOfferId: 'o1',
        offerName: 'Sem fonte',
        coberta: false,
      },
    ]);
  });

  /**
   * **Sem snapshot não é erro, é o convite ao botão** (§Escopo). A tela precisa
   * distinguir "nunca sincronizou" de "sincronizou e não achou nada" — as duas
   * pedem coisas diferentes do operador.
   */
  it('sem snapshot devolve lista vazia com fetchedAt nulo, sem erro', async () => {
    const { service } = montar({ snapshot: null });

    await expect(service.catalogo('t-1')).resolves.toEqual({
      ofertas: [],
      fetchedAt: null,
      fetchError: null,
    });
  });

  /**
   * A linha que só carrega o erro da primeira tentativa falha tem a época como
   * carimbo. Mostrar "1970" na tela seria pior que não mostrar data nenhuma.
   */
  it('traduz a época de volta para fetchedAt nulo, preservando o erro', async () => {
    const { service } = montar({
      snapshot: {
        payload: { produtos: [] },
        fetchedAt: NUNCA_SINCRONIZOU,
        fetchError: 'Kiwify recusou as credenciais (401)',
      },
    });

    const r = await service.catalogo('t-1');

    expect(r.fetchedAt).toBeNull();
    expect(r.fetchError).toContain('401');
  });

  /**
   * O critério de aceite da falha, visto do lado da leitura: o retrato anterior
   * continua listado, com a idade dele, **ao lado** do erro.
   */
  it('com fetchError, o retrato anterior continua listado com a idade dele', async () => {
    const { service } = montar({
      snapshot: {
        payload: {
          produtos: [{ id: 'p1', name: 'War Room', offers: [{ id: 'o1', name: 'Sem fonte' }] }],
        },
        fetchedAt: RETRATO,
        fetchError: 'Kiwify respondeu 502',
      },
    });

    const r = await service.catalogo('t-1');

    expect(r.ofertas).toHaveLength(1);
    expect(r.fetchedAt).toEqual(RETRATO);
    expect(r.fetchError).toContain('502');
  });

  it('oferta com de-para não aparece', async () => {
    const { service } = montar({
      mapeamentos: [{ externalProductId: 'p1', externalOfferId: 'o1' }],
    });

    await expect(service.catalogo('t-1')).resolves.toMatchObject({ ofertas: [] });
  });

  it('oferta já vista nos blocos 1/2 não repete aqui', async () => {
    const { service } = montar({
      vistas: [{ externalProductId: 'p1', externalOfferId: 'o1' }],
    });

    await expect(service.catalogo('t-1')).resolves.toMatchObject({ ofertas: [] });
  });

  /**
   * **Produto sem ofertas vira linha de curinga** — a doc oficial mostra produto
   * ativo com `offers: []` e preço no próprio produto (decisão do PI).
   */
  it('produto sem ofertas vira uma linha com offerId nulo', async () => {
    const { service } = montar({
      snapshot: {
        payload: { produtos: [{ id: 'p1', name: 'War Room', offers: [] }] },
        fetchedAt: RETRATO,
        fetchError: null,
      },
    });

    const r = await service.catalogo('t-1');

    expect(r.ofertas).toEqual([
      {
        externalProductId: 'p1',
        productName: 'War Room',
        externalOfferId: null,
        offerName: null,
        coberta: false,
      },
    ]);
  });

  /**
   * O payload é `Json` do Prisma: um snapshot gravado por uma versão anterior do
   * sync **não pode derrubar a aba inteira**. O externo aqui é o nosso próprio
   * passado.
   */
  it.each([
    ['nulo', null],
    ['sem a chave produtos', { outra: 'coisa' }],
    ['produtos não-array', { produtos: 'nada disso' }],
    ['produto sem id', { produtos: [{ name: 'sem id' }] }],
  ])('payload %s não quebra a leitura', async (_caso, payload) => {
    const { service } = montar({
      snapshot: { payload, fetchedAt: RETRATO, fetchError: null },
    });

    await expect(service.catalogo('t-1')).resolves.toMatchObject({ ofertas: [] });
  });

  /** Nenhuma chamada externa no caminho de renderização (§Notas técnicas). */
  it('lê apenas o snapshot — não existe caminho para a Kiwify aqui', async () => {
    const { service, prisma } = montar();

    await service.catalogo('t-1');

    expect(prisma.licCatalogSnapshot.findUnique as jest.Mock).toHaveBeenCalledWith({
      where: { tenantId: 't-1' },
      select: { payload: true, fetchedAt: true, fetchError: true },
    });
  });
});
