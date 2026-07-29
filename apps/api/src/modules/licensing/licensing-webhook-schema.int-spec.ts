/**
 * O schema da SPEC-038 (PR-1) contra Postgres REAL: isolamento, idempotência do
 * recebimento e as invariantes que o banco recusa.
 *
 * **Por que int-spec, e não teste de regra.** Nada aqui é lógica de aplicação —
 * é tudo policy, índice e CHECK. Um mock do Prisma "isola" o que o teste mandou
 * ele isolar e "recusa" o que o teste mandou recusar; as garantias desta fatia
 * só existem dentro do Postgres.
 *
 * Os quatro modos de errar que só aparecem assim:
 *
 * 1. **RLS ausente na tabela nova.** As quatro nascem com `ENABLE` + `FORCE`,
 *    e esquecer uma delas não quebra nada visível — o admin de um tenant
 *    simplesmente passaria a enxergar os eventos de venda de outro.
 * 2. **Idempotência do recebimento.** O `@@unique(platform, external_event_id)`
 *    é o que torna o retry da plataforma inofensivo. Se ele não existir, o
 *    código continua "funcionando" e cada reentrega emite outra licença.
 * 3. **`tenant_id` na chave de idempotência.** Ele NÃO está lá de propósito:
 *    com ele, a mesma entrega gravada em duas URLs viraria dois eventos. É uma
 *    ausência, e ausência não se prova lendo o schema — se prova tentando.
 * 4. **Coerência de estado.** `PROCESSED` sem `processed_at`, `SENT` sem
 *    `sent_at`, `FAILED` sem motivo: os três passariam por NOT NULL sem falhar
 *    nada e só apareceriam meses depois, no admin, como linha que não explica
 *    nada.
 */
import { PrismaClient } from '@prisma/client';
import { ownerClient, appClient, applyMigrations, grantAppRole } from '../../../test/int/db-harness';

const TENANT = '00000000-0000-4000-8000-11fec1c10101';
const OUTRO_TENANT = '00000000-0000-4000-8000-11fec1c10102';

describe('SPEC-038: schema do webhook, do e-mail e da configuração de venda', () => {
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
    // Resíduo do teste anterior falsearia contagem e colidiria com o unique.
    for (const tabela of ['lic_webhook_events', 'mail_deliveries', 'lic_offer_mappings']) {
      await owner.$executeRawUnsafe(
        `DELETE FROM ${tabela} WHERE tenant_id = ANY($1)`,
        [TENANT, OUTRO_TENANT],
      );
    }
  });

  // =========================================================================
  // Isolamento por tenant
  // =========================================================================

  describe('RLS: as quatro tabelas cortam por tenant', () => {
    it.each([
      ['lic_webhook_events', eventoDeWebhook],
      ['mail_deliveries', entregaDeEmail],
      ['lic_offer_mappings', mapeamentoDeOferta],
    ] as const)('%s só devolve as linhas do contexto', async (tabela, inserir) => {
      await inserir(owner, TENANT, 'a');
      await inserir(owner, OUTRO_TENANT, 'b');

      const vistas = await comoTenant(TENANT, `SELECT tenant_id FROM ${tabela}`);

      // Não basta "vê a própria": o teste que só conta 1 passaria com uma
      // policy que devolvesse a linha errada.
      expect(vistas).toHaveLength(1);
      expect(vistas[0].tenant_id).toBe(TENANT);
    });

    it('`lic_settings` só devolve a linha do contexto', async () => {
      // Fora do `it.each` porque `lic_settings` é 1:1 com o tenant e já nasce
      // semeada — recriar por teste colidiria com o unique.
      const vistas = await comoTenant(TENANT, `SELECT tenant_id FROM lic_settings`);
      expect(vistas).toHaveLength(1);
      expect(vistas[0].tenant_id).toBe(TENANT);
    });

    it.each([
      'lic_webhook_events',
      'mail_deliveries',
      'lic_offer_mappings',
      'lic_settings',
    ])('%s é fail-closed: sem contexto, nenhuma linha', async (tabela) => {
      // A pergunta que este teste responde não é "o RLS filtra?", é "o que
      // acontece quando ninguém disse quem eu sou?". Fail-OPEN aqui devolveria
      // o banco inteiro para qualquer caminho que esquecesse o contexto — e é
      // um esquecimento que não falha em lugar nenhum.
      const linhas = await app.$queryRawUnsafe(`SELECT tenant_id FROM ${tabela}`);
      expect(linhas).toEqual([]);
    });

    it('o segredo do webhook de um tenant não é legível pelo outro', async () => {
      // O caso concreto da decisão #1 do PI: é isto que faz o evento assinado
      // com o segredo do tenant A responder `401` na URL do tenant B.
      const vistas = await comoTenant<{ webhook_secret: string }>(
        OUTRO_TENANT,
        `SELECT webhook_secret FROM lic_settings`,
      );
      expect(vistas).toHaveLength(1);
      expect(vistas[0].webhook_secret).toBe('segredo-b');
    });
  });

  // =========================================================================
  // Idempotência do recebimento
  // =========================================================================

  describe('idempotência: o retry da plataforma é inofensivo', () => {
    it('a mesma entrega não grava duas linhas', async () => {
      await eventoDeWebhook(owner, TENANT, 'evt-1');

      // A asserção nomeia as COLUNAS da chave, não só "deu erro de unique": um
      // índice sobre o par errado também rejeitaria, e o teste passaria
      // dizendo que a idempotência existe onde ela não está.
      await expect(
        eventoDeWebhook(owner, TENANT, 'evt-1', { id: 'outro-id' }),
      ).rejects.toThrow(/23505.*\(platform, external_event_id\)/s);

      const linhas = await owner.$queryRawUnsafe(
        `SELECT id FROM lic_webhook_events WHERE external_event_id = 'evt-1'`,
      );
      expect(linhas).toHaveLength(1);
    });

    it('a MESMA entrega em dois tenants continua sendo uma só', async () => {
      // O `tenant_id` está FORA da chave de propósito: um id de evento da
      // Kiwify é único na Kiwify. Se ele entrasse na chave, a mesma entrega
      // chegando em duas URLs viraria dois eventos — e duas licenças.
      await eventoDeWebhook(owner, TENANT, 'evt-2');

      await expect(
        eventoDeWebhook(owner, OUTRO_TENANT, 'evt-2', { id: 'outro-id' }),
      ).rejects.toThrow(/23505.*\(platform, external_event_id\)/s);
    });

    it('plataformas diferentes com o mesmo id externo convivem', async () => {
      // O contrário do teste acima: `kiwify/evt-3` e `hotmart/evt-3` são
      // eventos distintos, e a chave é o PAR. Sem a plataforma na chave, a
      // segunda plataforma seria recusada por colisão de ids alheios.
      await eventoDeWebhook(owner, TENANT, 'evt-3');
      await eventoDeWebhook(owner, TENANT, 'evt-3', {
        id: 'outra-plat',
        platform: 'hotmart',
      });

      const linhas = await owner.$queryRawUnsafe(
        `SELECT platform FROM lic_webhook_events WHERE external_event_id = 'evt-3'`,
      );
      expect(linhas).toHaveLength(2);
    });
  });

  // =========================================================================
  // Coerência de estado
  // =========================================================================

  describe('o banco recusa o que a leitura não saberia explicar', () => {
    it('evento PROCESSED exige `processed_at`', async () => {
      await expect(
        eventoDeWebhook(owner, TENANT, 'evt-p', { status: 'PROCESSED' }),
      ).rejects.toThrow(/processed_coherent/);
    });

    it('evento PENDING não pode ter `processed_at`', async () => {
      // O inverso importa tanto quanto: PENDING carimbado diria que foi
      // processado e não foi, e o reprocessamento do admin pularia a linha.
      await expect(
        eventoDeWebhook(owner, TENANT, 'evt-pp', { processedAt: 'now()' }),
      ).rejects.toThrow(/processed_coherent/);
    });

    it('evento FAILED exige motivo legível', async () => {
      // FAILED sem motivo é o item da lista de pendências que ninguém sabe
      // como resolver — e a lista existe justamente para ser resolvida.
      await expect(
        eventoDeWebhook(owner, TENANT, 'evt-f', {
          status: 'FAILED',
          processedAt: 'now()',
        }),
      ).rejects.toThrow(/failure_explained/);
    });

    it('evento IGNORED é desfecho legítimo e não exige motivo', async () => {
      // Tipo desconhecido não é erro: a plataforma acrescenta tipos sem avisar.
      await eventoDeWebhook(owner, TENANT, 'evt-i', {
        status: 'IGNORED',
        processedAt: 'now()',
      });

      const [linha] = (await owner.$queryRawUnsafe(
        `SELECT status, error FROM lic_webhook_events WHERE external_event_id = 'evt-i'`,
      )) as Array<{ status: string; error: string | null }>;
      expect(linha.status).toBe('IGNORED');
      expect(linha.error).toBeNull();
    });

    it('entrega SENT exige `sent_at`, e `sent_at` exige SENT', async () => {
      await expect(
        entregaDeEmail(owner, TENANT, 'd1', { status: 'SENT' }),
      ).rejects.toThrow(/sent_coherent/);
      await expect(
        entregaDeEmail(owner, TENANT, 'd2', { sentAt: 'now()' }),
      ).rejects.toThrow(/sent_coherent/);
    });

    it('tolerância de inadimplência não aceita zero nem negativo', async () => {
      // Zero cortaria no mesmo instante do atraso — exatamente o comportamento
      // que a decisão #3 do PI recusou. Quem quer isso deixa a plataforma
      // revogar, o que é `null`, não `0`.
      await expect(
        owner.$executeRawUnsafe(
          `UPDATE lic_settings SET past_due_tolerance_days = 0 WHERE tenant_id = $1`,
          TENANT,
        ),
      ).rejects.toThrow(/tolerance_positive/);
      await expect(
        owner.$executeRawUnsafe(
          `UPDATE lic_settings SET past_due_tolerance_days = -1 WHERE tenant_id = $1`,
          TENANT,
        ),
      ).rejects.toThrow(/tolerance_positive/);
    });

    it('tolerância `null` é aceita — é o desligamento do corte', async () => {
      await owner.$executeRawUnsafe(
        `UPDATE lic_settings SET past_due_tolerance_days = NULL WHERE tenant_id = $1`,
        TENANT,
      );
      const [linha] = (await owner.$queryRawUnsafe(
        `SELECT past_due_tolerance_days AS dias FROM lic_settings WHERE tenant_id = $1`,
        TENANT,
      )) as Array<{ dias: number | null }>;
      expect(linha.dias).toBeNull();

      await owner.$executeRawUnsafe(
        `UPDATE lic_settings SET past_due_tolerance_days = 15 WHERE tenant_id = $1`,
        TENANT,
      );
    });

    it('segredo de webhook vazio é recusado', async () => {
      // Segredo vazio validaria assinatura contra a string vazia e a rota
      // continuaria respondendo 200 — a verificação viraria decorativa sem
      // nada falhar.
      await expect(
        owner.$executeRawUnsafe(
          `UPDATE lic_settings SET webhook_secret = '   ' WHERE tenant_id = $1`,
          TENANT,
        ),
      ).rejects.toThrow(/webhook_secret_present/);
    });
  });

  // =========================================================================
  // Mapeamento de oferta
  // =========================================================================

  describe('mapeamento oferta → edição', () => {
    it('duas linhas para a mesma oferta são recusadas', async () => {
      await mapeamentoDeOferta(owner, TENANT, 'm1', { offerId: 'of-1' });
      await expect(
        mapeamentoDeOferta(owner, TENANT, 'm2', { offerId: 'of-1' }),
      ).rejects.toThrow(
        /23505.*\(tenant_id, platform, external_product_id, external_offer_id\)/s,
      );
    });

    it('dois curingas do mesmo produto são recusados', async () => {
      // O caso que o unique comum NÃO cobre: em Postgres, NULL não colide com
      // NULL. Sem o índice parcial, dois mapeamentos "qualquer oferta deste
      // produto" apontando para edições diferentes conviveriam, e a compra
      // emitiria a licença de qualquer uma das duas.
      await mapeamentoDeOferta(owner, TENANT, 'm3', { offerId: null });
      // A chave citada no erro NÃO tem `external_offer_id`: é o índice parcial
      // que barrou, e não o unique comum (que deixaria passar, porque NULL não
      // colide com NULL). É a distinção que o teste existe para fazer.
      await expect(
        mapeamentoDeOferta(owner, TENANT, 'm4', { offerId: null }),
      ).rejects.toThrow(/23505.*\(tenant_id, platform, external_product_id\)=/s);
    });

    it('curinga e oferta específica do mesmo produto convivem', async () => {
      // É o desenho: o curinga cobre o produto, a linha específica sobrepõe
      // aquela oferta. Recusar isto tornaria impossível ter "anual" numa edição
      // e todo o resto noutra.
      await mapeamentoDeOferta(owner, TENANT, 'm5', { offerId: null });
      await mapeamentoDeOferta(owner, TENANT, 'm6', { offerId: 'of-anual' });

      const linhas = await owner.$queryRawUnsafe(
        `SELECT id FROM lic_offer_mappings WHERE tenant_id = $1`,
        TENANT,
      );
      expect(linhas).toHaveLength(2);
    });

    it('o mesmo produto em tenants diferentes não colide', async () => {
      // Dois tenants podem vender pela mesma plataforma com ids de produto que
      // não se relacionam. O `tenant_id` está na chave por isso.
      await mapeamentoDeOferta(owner, TENANT, 'm7', { offerId: 'of-x' });
      await mapeamentoDeOferta(owner, OUTRO_TENANT, 'm8', {
        offerId: 'of-x',
        edicao: 'wsedi-b',
      });

      const linhas = await owner.$queryRawUnsafe(
        `SELECT id FROM lic_offer_mappings WHERE external_offer_id = 'of-x'`,
      );
      expect(linhas).toHaveLength(2);
    });

    it('apagar a edição mapeada é recusado', async () => {
      // Restrict e não Cascade: apagar a edição deixaria o mapeamento apontando
      // para o nada, e a PRÓXIMA venda falharia sem que ninguém tivesse mexido
      // no mapeamento.
      await mapeamentoDeOferta(owner, TENANT, 'm9', { offerId: 'of-del' });
      await expect(
        owner.$executeRawUnsafe(`DELETE FROM lic_editions WHERE id = 'wsedi-a'`),
      ).rejects.toThrow(/foreign key|violates/i);
    });
  });

  // =========================================================================
  // A trilha sobrevive à licença
  // =========================================================================

  describe('apagar a licença não apaga a prova', () => {
    it('evento de webhook e entrega de e-mail viram órfãos, não sumem', async () => {
      // SetNull e não Cascade nos dois: a licença pode ser apagada, mas "esta
      // venda chegou" e "este e-mail saiu" são fatos sobre o passado, e o
      // suporte precisa deles justamente quando a licença não existe mais.
      await eventoDeWebhook(owner, TENANT, 'evt-orf', { licenseId: 'wslic-a' });
      await entregaDeEmail(owner, TENANT, 'd-orf', { licenseId: 'wslic-a' });

      await owner.$executeRawUnsafe(`DELETE FROM licenses WHERE id = 'wslic-a'`);

      const [evento] = (await owner.$queryRawUnsafe(
        `SELECT license_id FROM lic_webhook_events WHERE external_event_id = 'evt-orf'`,
      )) as Array<{ license_id: string | null }>;
      const [entrega] = (await owner.$queryRawUnsafe(
        `SELECT license_id FROM mail_deliveries WHERE id LIKE 'd-orf%'`,
      )) as Array<{ license_id: string | null }>;

      expect(evento.license_id).toBeNull();
      expect(entrega.license_id).toBeNull();

      await recriarLicenca();
    });
  });

  // =========================================================================
  // resolve_past_due_tolerance
  // =========================================================================

  describe('`resolve_past_due_tolerance`: a política lida sem sessão', () => {
    it('devolve a tolerância do tenant para quem não tem contexto', async () => {
      // `/activate` e `/heartbeat` não têm sessão e rodam sem `app.tenant_ids`.
      // Sem esta função, o RLS fail-closed devolveria vazio para TODO tenant e
      // a tolerância seria lida como "não configurada" em toda validação — o
      // corte por inadimplência nunca aconteceria, silenciosamente.
      const [linha] = (await app.$queryRawUnsafe(
        `SELECT resolve_past_due_tolerance($1) AS dias`,
        TENANT,
      )) as Array<{ dias: number | null }>;
      expect(linha.dias).toBe(15);
    });

    it('devolve NULL para tenant sem configuração', async () => {
      // **Ambiguidade conhecida e aceita**: NULL responde tanto "sem linha"
      // quanto "corte desligado". Os dois casos levam ao MESMO comportamento —
      // não cortar por atraso — e é o lado certo de errar: a alternativa
      // (tratar ausência como 15 dias) cortaria o acesso de um tenant que nunca
      // configurou nada.
      const [linha] = (await app.$queryRawUnsafe(
        `SELECT resolve_past_due_tolerance($1) AS dias`,
        '00000000-0000-4000-8000-11fec1c10999',
      )) as Array<{ dias: number | null }>;
      expect(linha.dias).toBeNull();
    });

    it('não devolve o segredo do webhook', async () => {
      // A função tem privilégio de owner. Se ela devolvesse o segredo, qualquer
      // chamador ganharia o poder de forjar entrega assinada — o segredo é lido
      // na rota, que já sabe o tenant pela URL e roda sob contexto.
      const [linha] = (await app.$queryRawUnsafe(
        `SELECT pg_get_functiondef(oid) AS fonte FROM pg_proc
         WHERE proname = 'resolve_past_due_tolerance'`,
      )) as Array<{ fonte: string }>;
      expect(linha.fonte).not.toMatch(/webhook_secret/);
    });
  });

  // =========================================================================
  // Fixtures
  // =========================================================================

  /** Roda a query sob o contexto de um tenant, como a aplicação faz. */
  async function comoTenant<T = { tenant_id: string }>(
    tenantId: string,
    sql: string,
  ): Promise<T[]> {
    return app.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SELECT set_config('app.tenant_ids', $1, true)`, `{${tenantId}}`);
      return tx.$queryRawUnsafe(sql) as Promise<T[]>;
    });
  }

  async function semear() {
    for (const [tenant, sufixo, segredo] of [
      [TENANT, 'a', 'segredo-a'],
      [OUTRO_TENANT, 'b', 'segredo-b'],
    ] as const) {
      await owner.$executeRawUnsafe(
        `INSERT INTO tenants (id, installation_id, account_login, account_type, created_at)
         VALUES ($1, NULL, $2, 'User', now()) ON CONFLICT (id) DO NOTHING`,
        tenant,
        `ws-${sufixo}`,
      );
      await owner.$executeRawUnsafe(
        `INSERT INTO lic_products (id, tenant_id, slug, name, key_prefix, created_at, updated_at)
         VALUES ($1, $2, 'warroom', 'War Room', 'WR', now(), now())
         ON CONFLICT (id) DO NOTHING`,
        `wsprod-${sufixo}`,
        tenant,
      );
      await owner.$executeRawUnsafe(
        `INSERT INTO lic_editions (id, product_id, slug, name, billing_model,
                                   max_machines, updates_months, created_at, updated_at)
         VALUES ($1, $2, 'closed', 'Sem código-fonte', 'SUBSCRIPTION', 2, 12, now(), now())
         ON CONFLICT (id) DO NOTHING`,
        `wsedi-${sufixo}`,
        `wsprod-${sufixo}`,
      );
      await owner.$executeRawUnsafe(
        `INSERT INTO lic_settings (id, tenant_id, webhook_secret, past_due_tolerance_days,
                                   created_at, updated_at)
         VALUES ($1, $2, $3, 15, now(), now()) ON CONFLICT (tenant_id) DO NOTHING`,
        `wsset-${sufixo}`,
        tenant,
        segredo,
      );
    }
    await recriarLicenca();
  }

  async function recriarLicenca() {
    await owner.$executeRawUnsafe(
      `INSERT INTO licenses (id, tenant_id, edition_id, key_hash, status, customer_email,
                             issued_at, updates_until, created_at, updated_at)
       VALUES ('wslic-a', $1, 'wsedi-a', $2, 'ACTIVE', 'comprador@exemplo.com',
               now(), now() + interval '12 months', now(), now())
       ON CONFLICT (id) DO NOTHING`,
      TENANT,
      'hash-ws-a',
    );
  }

  async function limpar() {
    const ids = [TENANT, OUTRO_TENANT];
    for (const tabela of [
      'lic_webhook_events',
      'mail_deliveries',
      'lic_offer_mappings',
      'lic_settings',
      'licenses',
      'lic_products',
    ]) {
      await owner.$executeRawUnsafe(`DELETE FROM ${tabela} WHERE tenant_id = ANY($1)`, ids);
    }
    await owner.$executeRawUnsafe(`DELETE FROM tenants WHERE id = ANY($1)`, ids);
  }
});

// ===========================================================================
// Inserções: SQL cru pelo OWNER, para exercitar o CHECK e não o Prisma.
// ===========================================================================

interface EventoOpts {
  id?: string;
  platform?: string;
  status?: string;
  processedAt?: string;
  licenseId?: string;
}

function eventoDeWebhook(
  db: PrismaClient,
  tenantId: string,
  externalEventId: string,
  opts: EventoOpts = {},
): Promise<number> {
  const {
    id = `ev-${tenantId.slice(-3)}-${externalEventId}`,
    platform = 'kiwify',
    status = 'PENDING',
    processedAt = 'NULL',
    licenseId,
  } = opts;
  return db.$executeRawUnsafe(
    `INSERT INTO lic_webhook_events
       (id, tenant_id, platform, external_event_id, event_type, payload,
        received_at, processed_at, status, license_id)
     VALUES ($1, $2, $3, $4, 'order.approved', '{}'::jsonb,
             now(), ${processedAt}, '${status}', ${licenseId ? `'${licenseId}'` : 'NULL'})`,
    id,
    tenantId,
    platform,
    externalEventId,
  );
}

interface EntregaOpts {
  status?: string;
  sentAt?: string;
  licenseId?: string;
}

function entregaDeEmail(
  db: PrismaClient,
  tenantId: string,
  id: string,
  opts: EntregaOpts = {},
): Promise<number> {
  const { status = 'PENDING', sentAt = 'NULL', licenseId } = opts;
  return db.$executeRawUnsafe(
    `INSERT INTO mail_deliveries
       (id, tenant_id, "to", template, subject, status, attempts, license_id,
        created_at, sent_at)
     VALUES ($1, $2, 'comprador@exemplo.com', 'license_key', 'Sua chave',
             '${status}', 0, ${licenseId ? `'${licenseId}'` : 'NULL'}, now(), ${sentAt})`,
    `${id}-${tenantId.slice(-3)}`,
    tenantId,
  );
}

interface MapeamentoOpts {
  offerId?: string | null;
  edicao?: string;
}

function mapeamentoDeOferta(
  db: PrismaClient,
  tenantId: string,
  id: string,
  opts: MapeamentoOpts = {},
): Promise<number> {
  const { offerId = null, edicao = 'wsedi-a' } = opts;
  return db.$executeRawUnsafe(
    `INSERT INTO lic_offer_mappings
       (id, tenant_id, platform, external_product_id, external_offer_id, edition_id,
        created_at, updated_at)
     VALUES ($1, $2, 'kiwify', 'prod-1', ${offerId ? `'${offerId}'` : 'NULL'}, $3,
             now(), now())`,
    `${id}-${tenantId.slice(-3)}`,
    tenantId,
    edicao,
  );
}
