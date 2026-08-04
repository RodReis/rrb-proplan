/**
 * O descarte da SPEC-045 contra Postgres REAL — as guardas que só o banco tem.
 *
 * **Por que int-spec.** Tudo aqui é CHECK e RLS. Um mock do Prisma "recusa" o
 * que o teste mandou recusar, então ele provaria apenas que o teste sabe
 * escrever `rejects`. As três classes de erro abaixo só aparecem contra Postgres:
 *
 * 1. **`DISCARDED` sem `processed_at`.** É a armadilha do #216, espelhada: o
 *    CHECK `processed_coherent` afirma `(status = 'PENDING') = (processed_at IS
 *    NULL)`, então descartar um evento que estava `PENDING` sem carimbar a data
 *    viola o CHECK e devolve `500` na tela — o botão que existe para limpar a
 *    lista sendo justamente o que não funciona. Se o teste de recusa parar de
 *    falhar, a guarda caiu.
 * 2. **Descarte sem motivo.** Passaria por `NOT NULL` sem dizer nada, e só
 *    apareceria meses depois como linha escondida que ninguém sabe por que
 *    sumiu — o mesmo item ilegível da lista de pendências, só que invisível.
 * 3. **Reabertura sem descarte.** Combinação que a rota já recusa com `409`;
 *    o CHECK é o que garante que nenhum caminho futuro (script, correção
 *    manual) a invente.
 */
import { PrismaClient } from '@prisma/client';
import { ownerClient, appClient, applyMigrations, grantAppRole } from '../../../test/int/db-harness';

const TENANT = '00000000-0000-4000-8000-11fec1c10201';
const OUTRO_TENANT = '00000000-0000-4000-8000-11fec1c10202';

describe('SPEC-045: descarte de entrega de webhook', () => {
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
    await owner.$executeRawUnsafe(
      `DELETE FROM lic_webhook_events WHERE tenant_id = ANY($1)`,
      [TENANT, OUTRO_TENANT],
    );
  });

  // =========================================================================
  // A armadilha do CHECK — o #216 espelhado
  // =========================================================================

  describe('`DISCARDED` é desfecho, não espera', () => {
    it('descartar carimbando `processed_at` é aceito', async () => {
      await evento(owner, TENANT, 'evt-ok', {
        status: 'FAILED',
        processedAt: 'now()',
        error: 'Oferta sem mapeamento: produto 764cd7eb',
      });

      await owner.$executeRawUnsafe(
        `UPDATE lic_webhook_events
            SET status = 'DISCARDED', processed_at = now(),
                discarded_at = now(), discarded_by = 'user-1',
                discarded_reason = 'disparo do botão Testar Webhook'
          WHERE external_event_id = 'evt-ok'`,
      );

      const [linha] = (await owner.$queryRawUnsafe(
        `SELECT status, processed_at, discarded_reason, error
           FROM lic_webhook_events WHERE external_event_id = 'evt-ok'`,
      )) as Array<{
        status: string;
        processed_at: Date | null;
        discarded_reason: string;
        error: string | null;
      }>;

      expect(linha.status).toBe('DISCARDED');
      expect(linha.processed_at).not.toBeNull();
      // **O `error` original sobrevive.** Ele responde "por que parou"; o
      // `discarded_reason` responde "por que desistimos". Uma pergunta não
      // pode comer a outra.
      expect(linha.error).toMatch(/Oferta sem mapeamento/);
    });

    it('descartar um PENDING sem carimbar `processed_at` é RECUSADO', async () => {
      // Esta é a linha que separa a SPEC-045 de repetir o #216. Se ela parar de
      // falhar, o CHECK caiu e o descarte vai devolver `500` na tela.
      await evento(owner, TENANT, 'evt-sem-data');

      await expect(
        owner.$executeRawUnsafe(
          `UPDATE lic_webhook_events
              SET status = 'DISCARDED', discarded_at = now(),
                  discarded_by = 'user-1', discarded_reason = 'teste'
            WHERE external_event_id = 'evt-sem-data'`,
        ),
      ).rejects.toThrow(/processed_coherent/);
    });
  });

  // =========================================================================
  // Descarte sem motivo
  // =========================================================================

  describe('o banco recusa descarte que a leitura não saberia explicar', () => {
    it.each([
      ['motivo ausente', 'NULL'],
      ['motivo vazio', `''`],
      ['motivo só com espaços', `'   '`],
    ])('%s é recusado', async (_caso, motivo) => {
      await evento(owner, TENANT, `evt-${_caso.replace(/\s/g, '-')}`, {
        status: 'FAILED',
        processedAt: 'now()',
        error: 'falhou',
      });

      await expect(
        owner.$executeRawUnsafe(
          `UPDATE lic_webhook_events
              SET status = 'DISCARDED', processed_at = now(),
                  discarded_at = now(), discarded_by = 'user-1',
                  discarded_reason = ${motivo}
            WHERE external_event_id = '${`evt-${_caso.replace(/\s/g, '-')}`}'`,
        ),
      ).rejects.toThrow(/discard_explained/);
    });

    it('descarte sem `discarded_at` é recusado', async () => {
      await evento(owner, TENANT, 'evt-sem-quando', {
        status: 'FAILED',
        processedAt: 'now()',
        error: 'falhou',
      });

      await expect(
        owner.$executeRawUnsafe(
          `UPDATE lic_webhook_events
              SET status = 'DISCARDED', processed_at = now(),
                  discarded_reason = 'sem o quando'
            WHERE external_event_id = 'evt-sem-quando'`,
        ),
      ).rejects.toThrow(/discard_explained/);
    });
  });

  // =========================================================================
  // Reabertura
  // =========================================================================

  describe('reabrir depende de ter sido descartado', () => {
    it('`reopened_at` sem `discarded_at` é recusado', async () => {
      await evento(owner, TENANT, 'evt-reabre-nunca');

      await expect(
        owner.$executeRawUnsafe(
          `UPDATE lic_webhook_events SET reopened_at = now()
            WHERE external_event_id = 'evt-reabre-nunca'`,
        ),
      ).rejects.toThrow(/reopen_after_discard/);
    });

    it('reabrir um descartado volta a PENDING e preserva a trilha do descarte', async () => {
      await evento(owner, TENANT, 'evt-volta', {
        status: 'FAILED',
        processedAt: 'now()',
        error: 'Oferta sem mapeamento',
      });
      await owner.$executeRawUnsafe(
        `UPDATE lic_webhook_events
            SET status = 'DISCARDED', processed_at = now(), discarded_at = now(),
                discarded_by = 'user-1', discarded_reason = 'engano'
          WHERE external_event_id = 'evt-volta'`,
      );

      // O caminho do `reopen`: PENDING exige `processed_at` NULL (CHECK), e o
      // `error` sai porque a tentativa antiga não descreve mais o estado atual.
      await owner.$executeRawUnsafe(
        `UPDATE lic_webhook_events
            SET status = 'PENDING', processed_at = NULL, error = NULL,
                reopened_at = now()
          WHERE external_event_id = 'evt-volta'`,
      );

      const [linha] = (await owner.$queryRawUnsafe(
        `SELECT status, reopened_at, discarded_at, discarded_reason
           FROM lic_webhook_events WHERE external_event_id = 'evt-volta'`,
      )) as Array<{
        status: string;
        reopened_at: Date | null;
        discarded_at: Date | null;
        discarded_reason: string | null;
      }>;

      expect(linha.status).toBe('PENDING');
      expect(linha.reopened_at).not.toBeNull();
      // A trilha do descarte PERMANECE: é a prova de que esta entrega já foi
      // descartada uma vez, e o CHECK de reabertura depende dela.
      expect(linha.discarded_at).not.toBeNull();
      expect(linha.discarded_reason).toBe('engano');
    });
  });

  // =========================================================================
  // Isolamento
  // =========================================================================

  it('RLS: o descarte de um tenant não enxerga a entrega de outro', async () => {
    await evento(owner, TENANT, 'evt-meu', {
      status: 'FAILED',
      processedAt: 'now()',
      error: 'falhou',
    });
    await evento(owner, OUTRO_TENANT, 'evt-alheio', {
      status: 'FAILED',
      processedAt: 'now()',
      error: 'falhou',
    });

    await app.$executeRawUnsafe(`SET app.tenant_id = '${TENANT}'`);

    // O UPDATE alheio não erra — ele simplesmente não alcança linha nenhuma.
    // É o modo silencioso do RLS, e é por isso que a asserção conta linhas em
    // vez de esperar exceção.
    const afetadas = await app.$executeRawUnsafe(
      `UPDATE lic_webhook_events
          SET status = 'DISCARDED', processed_at = now(), discarded_at = now(),
              discarded_by = 'user-1', discarded_reason = 'invasão'
        WHERE external_event_id = 'evt-alheio'`,
    );
    expect(afetadas).toBe(0);

    const [alheio] = (await owner.$queryRawUnsafe(
      `SELECT status FROM lic_webhook_events WHERE external_event_id = 'evt-alheio'`,
    )) as Array<{ status: string }>;
    expect(alheio.status).toBe('FAILED');
  });

  // =========================================================================
  // Fixtures
  // =========================================================================

  interface EventoOpts {
    id?: string;
    status?: string;
    processedAt?: string;
    error?: string;
  }

  function evento(
    db: PrismaClient,
    tenantId: string,
    externalEventId: string,
    opts: EventoOpts = {},
  ): Promise<number> {
    const {
      id = `ev-${tenantId.slice(-3)}-${externalEventId}`,
      status = 'PENDING',
      processedAt = 'NULL',
      error,
    } = opts;
    return db.$executeRawUnsafe(
      `INSERT INTO lic_webhook_events
         (id, tenant_id, platform, external_event_id, event_type, payload,
          received_at, processed_at, status, error)
       VALUES ($1, $2, 'kiwify', $3, 'order.approved', '{}'::jsonb,
               now(), ${processedAt}, '${status}', ${error ? `'${error}'` : 'NULL'})`,
      id,
      tenantId,
      externalEventId,
    );
  }

  async function semear() {
    for (const t of [TENANT, OUTRO_TENANT]) {
      await owner.$executeRawUnsafe(
        `INSERT INTO tenants (id, account_login, account_type, created_at)
         VALUES ($1, $2, 'User', now()) ON CONFLICT (id) DO NOTHING`,
        t,
        `spec045-${t.slice(-3)}`,
      );
    }
  }

  async function limpar() {
    await owner.$executeRawUnsafe(
      `DELETE FROM lic_webhook_events WHERE tenant_id = ANY($1)`,
      [TENANT, OUTRO_TENANT],
    );
    await owner.$executeRawUnsafe(`DELETE FROM tenants WHERE id = ANY($1)`, [
      TENANT,
      OUTRO_TENANT,
    ]);
  }
});
