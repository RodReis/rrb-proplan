/**
 * As colunas da SPEC-042 contra Postgres REAL.
 *
 * **Por que int-spec, e não teste de regra.** O service já tem o teste da
 * validação e o template o dos blocos condicionais — ambos com mock. O que o
 * mock não tem é o banco, e são três coisas que só existem lá:
 *
 * 1. **As colunas existem e são nullable.** Uma migration esquecida no PR não
 *    quebra teste nenhum com mock do Prisma — quebra na primeira venda em
 *    produção, com a licença já emitida e o e-mail já enfileirado.
 * 2. **`NULL` é gravável.** É o estado de todo produto antes de alguém
 *    preencher a tela, e o que o template lê para omitir os blocos. Um `NOT
 *    NULL` acidental transformaria "não configurado" em erro de escrita.
 * 3. **O RLS de `lic_products` continua cobrindo as colunas novas.** A policy é
 *    da tabela, não da coluna — mas é exatamente por isso que se confere: o
 *    `downloadUrl` do tenant vizinho é o link do produto que ele vende, e o
 *    modo de errar aqui é mudo.
 */
import { PrismaClient } from '@prisma/client';
import {
  ownerClient,
  appClient,
  applyMigrations,
  grantAppRole,
} from '../../../test/int/db-harness';

const TENANT = '00000000-0000-4000-8000-11fec1c10401';
const OUTRO_TENANT = '00000000-0000-4000-8000-11fec1c10402';

const DOWNLOAD_A = 'https://github.com/RodReis/war-room-releases/releases/latest';
const MANUAL_A = 'https://war-room.rrbtrading.com.br/manual';

describe('SPEC-042: URLs de entrega no `lic_products`', () => {
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

  it('grava e devolve as duas URLs', async () => {
    const [linha] = await comoTenant<{
      download_url: string | null;
      manual_url: string | null;
    }>(
      TENANT,
      `SELECT download_url, manual_url FROM lic_products WHERE id = 'urlprod-a'`,
    );

    expect(linha.download_url).toBe(DOWNLOAD_A);
    expect(linha.manual_url).toBe(MANUAL_A);
  });

  it('aceita `NULL` nas duas — ausente é estado normal, não erro', async () => {
    // O produto do outro tenant nasceu sem URL nenhuma. Se alguma das colunas
    // fosse `NOT NULL`, este `INSERT` do `semear()` teria falhado — e o produto
    // entregue por outro canal não teria como existir.
    const [linha] = await comoTenant<{
      download_url: string | null;
      manual_url: string | null;
    }>(
      OUTRO_TENANT,
      `SELECT download_url, manual_url FROM lic_products WHERE id = 'urlprod-b'`,
    );

    expect(linha.download_url).toBeNull();
    expect(linha.manual_url).toBeNull();
  });

  it('limpar volta para `NULL`, e não para string vazia', async () => {
    await owner.$executeRawUnsafe(
      `UPDATE lic_products SET download_url = NULL WHERE id = 'urlprod-a'`,
    );

    const [linha] = await comoTenant<{ download_url: string | null }>(
      TENANT,
      `SELECT download_url FROM lic_products WHERE id = 'urlprod-a'`,
    );
    expect(linha.download_url).toBeNull();

    await owner.$executeRawUnsafe(
      `UPDATE lic_products SET download_url = $1 WHERE id = 'urlprod-a'`,
      DOWNLOAD_A,
    );
  });

  it('o tenant vizinho não lê a URL alheia', async () => {
    // A policy é da tabela e não da coluna — mas é por isso que se confere aqui:
    // o `download_url` do vizinho é o link do produto que ele vende, e uma
    // policy que cobrisse só as colunas antigas falharia em silêncio.
    const vistas = await comoTenant<{ id: string; download_url: string | null }>(
      OUTRO_TENANT,
      `SELECT id, download_url FROM lic_products`,
    );

    expect(vistas).toHaveLength(1);
    expect(vistas[0].id).toBe('urlprod-b');
    expect(vistas.map((v) => v.download_url)).not.toContain(DOWNLOAD_A);
  });

  async function comoTenant<T = { tenant_id: string }>(
    tenantId: string,
    sql: string,
  ): Promise<T[]> {
    return app.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(
        `SELECT set_config('app.tenant_ids', $1, true)`,
        `{${tenantId}}`,
      );
      return tx.$queryRawUnsafe(sql) as Promise<T[]>;
    });
  }

  async function semear() {
    for (const [tenant, id, sufixo, download, manual] of [
      [TENANT, 'urlprod-a', 'a', DOWNLOAD_A, MANUAL_A],
      // O outro nasce SEM URL: é o estado de quem ainda não preencheu a tela, e
      // o que o teste do `NULL` observa.
      [OUTRO_TENANT, 'urlprod-b', 'b', null, null],
    ] as const) {
      await owner.$executeRawUnsafe(
        `INSERT INTO tenants (id, installation_id, account_login, account_type, created_at)
         VALUES ($1, NULL, $2, 'User', now()) ON CONFLICT (id) DO NOTHING`,
        tenant,
        `urls-${sufixo}`,
      );
      await owner.$executeRawUnsafe(
        `INSERT INTO lic_products (id, tenant_id, slug, name, key_prefix,
                                   download_url, manual_url, created_at, updated_at)
         VALUES ($1, $2, 'warroom', 'War Room', 'WR', $3, $4, now(), now())
         ON CONFLICT (id) DO NOTHING`,
        id,
        tenant,
        download,
        manual,
      );
    }
  }

  async function limpar() {
    const ids = [TENANT, OUTRO_TENANT];
    await owner.$executeRawUnsafe(
      `DELETE FROM lic_products WHERE tenant_id = ANY($1)`,
      ids,
    );
    await owner.$executeRawUnsafe(`DELETE FROM tenants WHERE id = ANY($1)`, ids);
  }
});
