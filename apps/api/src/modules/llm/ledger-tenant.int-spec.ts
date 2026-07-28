/**
 * O dono do gasto no ledger, contra Postgres REAL.
 *
 * O mock do `llm-usage.recorder.spec.ts` prova que o recorder *passa* o
 * `tenantId` ao Prisma. Só o banco prova o que importa de verdade: que a linha
 * **nasce** com o tenant, e que ela é visível ao tenant certo sob RLS.
 *
 * A distinção não é preciosismo. O bug que esta fatia corrige passou dois meses
 * despercebido justamente porque nada além do banco o revelava: a coluna
 * `tenant_id` nasceu na Fatia 8 com backfill único, nada a preencheu depois, e
 * a policy aceita NULL de propósito (histórico órfão, decisão F4). Suíte verde,
 * coluna vazia.
 */
import { PrismaClient } from '@prisma/client';
import { ownerClient, appClient, applyMigrations, grantAppRole } from '../../../test/int/db-harness';
import { LlmUsageRecorder } from './application/llm-usage.recorder';
import type { PrismaService } from '../../prisma/prisma.service';

const TENANT_A = '00000000-0000-4000-8000-1ed6e0000001';
const TENANT_B = '00000000-0000-4000-8000-1ed6e0000002';

function fakeClient() {
  return {
    provider: 'anthropic',
    model: 'claude-haiku-4-5-20251001',
    complete: async () => ({
      text: '{"ok":true}',
      model: 'claude-haiku-4-5-20251001',
      inputTokens: 100,
      outputTokens: 50,
      cacheCreationTokens: 0,
      cacheReadTokens: 0,
    }),
  } as never;
}

async function withTenant<T>(
  client: PrismaClient,
  tenantIds: string[],
  fn: (tx: PrismaClient) => Promise<T>,
): Promise<T> {
  const arrayLiteral = `{${tenantIds.join(',')}}`;
  return client.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.tenant_ids', ${arrayLiteral}, true)`;
    return fn(tx as unknown as PrismaClient);
  });
}

/**
 * Limpa por `artifact_run_id`, NÃO por `tenant_id`.
 *
 * A diferença apareceu provando a guarda: com a correção sabotada, as linhas
 * nasceram com `tenant_id` NULL, escaparam de um DELETE por tenant e
 * sobreviveram para a rodada seguinte — que passou a ver duas linhas onde
 * esperava uma. **Limpeza que depende da coluna sob teste deixa de limpar
 * exatamente quando o teste falha**, e o resultado é uma segunda falha que não
 * tem nada a ver com o defeito.
 */
async function limpar(client: PrismaClient): Promise<void> {
  await client.$executeRawUnsafe(
    `DELETE FROM llm_usage WHERE artifact_run_id LIKE 'run-int-%'`,
  );
}

describe('llm_usage: o dono do gasto (ADR-026 + SPEC-032 §5)', () => {
  let owner: PrismaClient;
  let app: PrismaClient;

  beforeAll(async () => {
    applyMigrations();
    owner = ownerClient();
    app = appClient(1);
    await grantAppRole(owner);
    // Entrada limpa: uma rodada anterior interrompida (ou com a correção
    // sabotada) pode ter deixado linha para trás, e ela mudaria a contagem aqui.
    await limpar(owner);

    for (const [id, login] of [
      [TENANT_A, 'ledger-a'],
      [TENANT_B, 'ledger-b'],
    ]) {
      await owner.$executeRawUnsafe(
        `INSERT INTO tenants (id, installation_id, account_login, account_type, created_at)
         VALUES ($1, NULL, $2, 'User', now()) ON CONFLICT (id) DO NOTHING`,
        id,
        login,
      );
    }
  });

  afterAll(async () => {
    await limpar(owner);
    await owner.$executeRawUnsafe(`DELETE FROM tenants WHERE id = ANY($1)`, [TENANT_A, TENANT_B]);
    await owner.$disconnect();
    await app.$disconnect();
  });

  it('a linha do pipeline nasce COM tenant_id, sem projectId', async () => {
    // O caminho anônimo: nasce de ClientProject, não do `Project` do ledger.
    // Antes desta fatia, esta linha teria tenant_id NULL.
    const rec = new LlmUsageRecorder(owner as unknown as PrismaService);

    await rec.run(fakeClient(), { system: 's', user: 'u', maxTokens: 100 }, {
      projectId: null,
      tenantId: TENANT_A,
      artifactRunId: 'run-int-1',
      kind: 'artifact_scope',
    });

    const rows = (await owner.$queryRawUnsafe(
      `SELECT tenant_id, project_id, artifact_run_id FROM llm_usage WHERE artifact_run_id = 'run-int-1'`,
    )) as Array<Record<string, unknown>>;

    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({
      tenant_id: TENANT_A,
      project_id: null,
      artifact_run_id: 'run-int-1',
    });
  });

  it('o gasto de um tenant NÃO aparece na leitura do outro', async () => {
    // A consequência prática do bug: com tenant_id NULL, a policy
    // (`tenant_id IS NULL` = do tenant ativo) faria esta linha ser somada no
    // teto de QUALQUER um que olhasse.
    const rec = new LlmUsageRecorder(owner as unknown as PrismaService);

    await rec.run(fakeClient(), { system: 's', user: 'u', maxTokens: 100 }, {
      projectId: null,
      tenantId: TENANT_B,
      artifactRunId: 'run-int-2',
      kind: 'artifact_scope',
    });

    const vistoPorA = await withTenant(app, [TENANT_A], (tx) =>
      tx.$queryRawUnsafe(
        `SELECT artifact_run_id FROM llm_usage WHERE artifact_run_id = 'run-int-2'`,
      ),
    );
    const vistoPorB = await withTenant(app, [TENANT_B], (tx) =>
      tx.$queryRawUnsafe(
        `SELECT artifact_run_id FROM llm_usage WHERE artifact_run_id = 'run-int-2'`,
      ),
    );

    expect(vistoPorA).toEqual([]);
    expect(vistoPorB).toEqual([{ artifact_run_id: 'run-int-2' }]);
  });

  it('"quanto custou este briefing" responde por consulta ao ledger', async () => {
    // §5: sem derivar de ArtifactVersion (ADR-016). Duas chamadas do mesmo run
    // somam; a de outro run não entra.
    const rec = new LlmUsageRecorder(owner as unknown as PrismaService);
    const ctx = {
      projectId: null,
      tenantId: TENANT_A,
      artifactRunId: 'run-int-3',
      kind: 'artifact_normalize',
    };

    await rec.run(fakeClient(), { system: 's', user: 'u', maxTokens: 100 }, ctx);
    await rec.run(fakeClient(), { system: 's', user: 'u', maxTokens: 100 }, ctx);

    const rows = (await owner.$queryRawUnsafe(
      `SELECT count(*)::int AS chamadas, sum(input_tokens)::int AS tokens
       FROM llm_usage WHERE artifact_run_id = 'run-int-3'`,
    )) as Array<{ chamadas: number; tokens: number }>;

    expect(rows[0]).toEqual({ chamadas: 2, tokens: 200 });
  });
});
