/**
 * `GET /licensing/seen-offers` contra Postgres REAL — as ofertas que já
 * chegaram e ainda não têm mapeamento (FIX do dogfooding, 2026-07-31).
 *
 * **Por que int-spec, e não teste de regra.** A regra de quais ofertas sobram já
 * tem teste puro (`seen-offers.spec.ts`). O que só o Postgres prova é o resto do
 * caminho: que o `payload` **JSON** é lido, que o parser extrai o produto de
 * dentro dele, e que o RLS não deixa vazar a oferta de um tenant para o admin de
 * outro.
 *
 * Os três modos de errar que um mock do Prisma esconderia:
 *
 * 1. **Ler o payload errado.** `externalProductId` não é coluna — vive dentro do
 *    JSON. Um mock devolveria o objeto que o teste mandou; aqui o dado passa
 *    pelo `jsonb` de verdade e pelo parser da Kiwify.
 * 2. **Vazamento entre tenants.** A rota lê `licWebhookEvent` sem `where` de
 *    tenant, confiando no RLS. Se a policy não cobrir a tabela, o admin de um
 *    tenant veria a oferta do outro — e o modo de errar é silencioso.
 * 3. **Curinga que não filtra.** O mapeamento com `external_offer_id NULL` sai
 *    do banco como `null` de verdade; um mock com `undefined` faria o
 *    casamento passar por engano.
 */
import { PrismaClient } from '@prisma/client';
import { ownerClient, appClient, applyMigrations, grantAppRole } from '../../../test/int/db-harness';
import { LicensingOpsService } from './application/licensing-ops.service';

const TENANT = '00000000-0000-4000-8000-11fec1c10301';
const OUTRO_TENANT = '00000000-0000-4000-8000-11fec1c10302';

/** Payload no formato que a Kiwify manda — o produto vive aqui dentro. */
function payload(produtoId: string) {
  return {
    order_status: 'paid',
    webhook_event_type: 'order_approved',
    order_ref: `ord-${produtoId}`,
    Product: { product_id: produtoId },
    Customer: { email: 'comprador@exemplo.com', full_name: 'Comprador' },
  };
}

describe('SPEC-038: ofertas vistas e ainda não mapeadas', () => {
  let owner: PrismaClient;
  let app: PrismaClient;

  beforeAll(async () => {
    applyMigrations();
    owner = ownerClient();
    app = appClient();
    await grantAppRole(owner);
    await semear();
  });

  afterAll(async () => {
    await limpar();
    await owner.$disconnect();
    await app.$disconnect();
  });

  beforeEach(async () => {
    for (const tabela of ['lic_webhook_events', 'lic_offer_mappings']) {
      await owner.$executeRawUnsafe(
        `DELETE FROM ${tabela} WHERE tenant_id = ANY($1)`,
        [TENANT, OUTRO_TENANT],
      );
    }
  });

  it('lê o produto de DENTRO do payload jsonb', async () => {
    // O ponto do teste: `external_product_id` não é coluna. Um mock devolveria
    // o objeto pronto; aqui o dado atravessa o jsonb e o parser.
    await inserirEvento(TENANT, 'PROD-A', 'FAILED');

    const r = await listar(TENANT);

    expect(r).toHaveLength(1);
    expect(r[0].externalProductId).toBe('PROD-A');
    expect(r[0].falhas).toBe(1);
  });

  it('agrupa entregas do mesmo produto numa linha só', async () => {
    await inserirEvento(TENANT, 'PROD-A', 'FAILED');
    await inserirEvento(TENANT, 'PROD-A', 'FAILED');
    await inserirEvento(TENANT, 'PROD-A', 'PROCESSED');

    const r = await listar(TENANT);

    expect(r).toHaveLength(1);
    expect(r[0].ocorrencias).toBe(3);
    expect(r[0].falhas).toBe(2);
  });

  it('o curinga já cadastrado tira a oferta da lista', async () => {
    // `external_offer_id NULL` sai do banco como `null` de verdade — um mock com
    // `undefined` faria o casamento passar por engano.
    await inserirEvento(TENANT, 'PROD-A', 'FAILED');
    await inserirMapeamento(TENANT, 'PROD-A');

    expect(await listar(TENANT)).toEqual([]);
  });

  it('mapeamento de OUTRO produto não esconde este', async () => {
    await inserirEvento(TENANT, 'PROD-A', 'FAILED');
    await inserirMapeamento(TENANT, 'PROD-B');

    const r = await listar(TENANT);

    expect(r).toHaveLength(1);
    expect(r[0].externalProductId).toBe('PROD-A');
  });

  it('NÃO vaza a oferta de outro tenant — a rota confia no RLS', async () => {
    // A consulta não tem `where` de tenant: quem isola é a policy. Sem ela, o
    // admin de um tenant veria a venda do outro, em silêncio.
    await inserirEvento(OUTRO_TENANT, 'PROD-DO-OUTRO', 'FAILED');
    await inserirEvento(TENANT, 'PROD-A', 'FAILED');

    const r = await listar(TENANT);

    expect(r.map((o) => o.externalProductId)).toEqual(['PROD-A']);
  });

  it('evento de plataforma sem parser não vira linha', async () => {
    // Só a Kiwify tem parser hoje. Inventar um id a partir de payload
    // desconhecido seria pior que omitir.
    await owner.$executeRawUnsafe(
      `INSERT INTO lic_webhook_events
         (id, tenant_id, platform, external_event_id, event_type, payload, status, error,
          received_at, processed_at)
       VALUES (gen_random_uuid(), $1, 'outra-plataforma', $2, 'venda', $3::jsonb,
               'FAILED', 'erro', now(), now())`,
      TENANT,
      `ev-outra-${Date.now()}`,
      JSON.stringify({ qualquer: 'coisa' }),
    );

    expect(await listar(TENANT)).toEqual([]);
  });

  // =========================================================================

  /** Roda a leitura sob o contexto do tenant, como a request faria. */
  async function listar(tenantId: string) {
    return app.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(
        `SELECT set_config('app.tenant_ids', $1, true)`,
        `{${tenantId}}`,
      );
      const service = new LicensingOpsService(
        tx as never,
        { add: async () => undefined } as never,
        // `listSeenOffers` não cifra nada — o crypto só entra no
        // `updateSettings` (SPEC-047). Stub que explode se for chamado: um dia
        // em que esta leitura passar a cifrar, o teste acusa em vez de passar.
        {
          encrypt: () => {
            throw new Error('listSeenOffers não deve cifrar');
          },
        } as never,
      );
      return service.listSeenOffers();
    });
  }

  async function inserirEvento(tenantId: string, produtoId: string, status: string) {
    await owner.$executeRawUnsafe(
      // `processed_at` só é nulo em `PENDING` (CHECK
      // `lic_webhook_events_processed_coherent`): `FAILED` e `IGNORED` também
      // carimbam, porque "quando desistimos disto?" é pergunta do suporte.
      `INSERT INTO lic_webhook_events
         (id, tenant_id, platform, external_event_id, event_type, payload, status, error,
          received_at, processed_at)
       VALUES (gen_random_uuid(), $1, 'kiwify', $2, 'order_approved', $3::jsonb,
               $4::"LicWebhookStatus", $5, now(),
               CASE WHEN $4 = 'PENDING' THEN NULL ELSE now() END)`,
      tenantId,
      `ev-${produtoId}-${Math.random().toString(36).slice(2)}`,
      JSON.stringify(payload(produtoId)),
      status,
      status === 'FAILED' ? `Oferta sem mapeamento: produto ${produtoId}, oferta (nenhuma)` : null,
    );
  }

  async function inserirMapeamento(tenantId: string, produtoId: string) {
    const edicao = await owner.licEdition.findFirst({
      where: { product: { tenantId } },
      select: { id: true },
    });
    await owner.$executeRawUnsafe(
      `INSERT INTO lic_offer_mappings
         (id, tenant_id, platform, external_product_id, external_offer_id, edition_id,
          created_at, updated_at)
       VALUES (gen_random_uuid(), $1, 'kiwify', $2, NULL, $3, now(), now())`,
      tenantId,
      produtoId,
      edicao!.id,
    );
  }

  async function semear() {
    for (const id of [TENANT, OUTRO_TENANT]) {
      await owner.$executeRawUnsafe(
        `INSERT INTO tenants (id, installation_id, account_login, account_type, created_at)
         VALUES ($1, NULL, $2, 'User', now()) ON CONFLICT (id) DO NOTHING`,
        id,
        `seen-offers-${id.slice(-4)}`,
      );
      const produto = await owner.licProduct.create({
        data: {
          tenantId: id,
          slug: `p-${id.slice(-4)}`,
          name: 'Produto',
          keyPrefix: 'PX',
        },
      });
      await owner.licEdition.create({
        data: { productId: produto.id, slug: 'std', name: 'Padrão' },
      });
    }
  }

  async function limpar() {
    for (const tabela of [
      'lic_webhook_events',
      'lic_offer_mappings',
      'lic_editions',
      'lic_products',
    ]) {
      await owner
        .$executeRawUnsafe(
          `DELETE FROM ${tabela} WHERE tenant_id = ANY($1)`,
          [TENANT, OUTRO_TENANT],
        )
        .catch(() => undefined);
    }
    await owner.$executeRawUnsafe(`DELETE FROM tenants WHERE id = ANY($1)`, [
      TENANT,
      OUTRO_TENANT,
    ]);
  }
});
