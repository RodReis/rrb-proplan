import { Prisma } from '@prisma/client';
import { LlmUsageRecorder } from './llm-usage.recorder';

const PRICE = {
  inputPer1M: new Prisma.Decimal('3'),
  outputPer1M: new Prisma.Decimal('15'),
  cacheWritePer1M: new Prisma.Decimal('3.75'),
  cacheReadPer1M: new Prisma.Decimal('0.30'),
  effectiveFrom: new Date('2026-01-01'),
};

function makePrisma(projectTenantId: string | null = 'tenant-do-projeto') {
  const rows: any[] = [];
  return {
    rows,
    prisma: {
      modelPrice: { findFirst: jest.fn().mockResolvedValue(PRICE) },
      // O recorder resolve o dono do gasto a partir do projeto quando o
      // chamador não o informa (SPEC-032).
      project: {
        findUnique: jest.fn().mockResolvedValue(
          projectTenantId === null ? null : { tenantId: projectTenantId },
        ),
      },
      llmUsage: {
        create: jest.fn(({ data }) => {
          rows.push(data);
          return Promise.resolve(data);
        }),
      },
    } as any,
  };
}

function fakeClient(overrides: Partial<{ complete: any }> = {}) {
  return {
    provider: 'anthropic',
    complete:
      overrides.complete ??
      jest.fn().mockResolvedValue({
        text: '{"ok":true}',
        model: 'claude-sonnet-5',
        inputTokens: 1000,
        outputTokens: 500,
        cacheCreationTokens: 0,
        cacheReadTokens: 0,
      }),
  } as any;
}

const req = { system: 's', user: 'u', maxTokens: 100 };
const ctx = { projectId: 'p1', kind: 'summary' };

describe('LlmUsageRecorder', () => {
  it('run: sucesso grava UMA linha status ok com custo da tabela', async () => {
    const { prisma, rows } = makePrisma();
    const rec = new LlmUsageRecorder(prisma);

    const res = await rec.run(fakeClient(), req, ctx);

    expect(res.text).toBe('{"ok":true}');
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('ok');
    expect(rows[0].costSource).toBe('table');
    expect(rows[0].kind).toBe('summary');
  });

  it('run: erro de chamada grava linha status error e RELANÇA', async () => {
    const { prisma, rows } = makePrisma();
    const rec = new LlmUsageRecorder(prisma);
    const client = fakeClient({ complete: jest.fn().mockRejectedValue(new Error('timeout')) });

    await expect(rec.run(client, req, ctx)).rejects.toThrow('timeout');
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('error');
    expect(rows[0].inputTokens).toBe(0); // timeout puro → sem usage
    expect(rows[0].errorCode).toContain('timeout');
  });

  it('runParsed: parse inválido na 1ª, ok na 2ª → DUAS linhas (discarded + ok)', async () => {
    const { prisma, rows } = makePrisma();
    const rec = new LlmUsageRecorder(prisma);
    let call = 0;
    const client = fakeClient({
      complete: jest.fn().mockImplementation(() => {
        call++;
        return Promise.resolve({
          text: call === 1 ? 'lixo' : '{"v":1}',
          model: 'claude-sonnet-5', inputTokens: 100, outputTokens: 50, cacheCreationTokens: 0, cacheReadTokens: 0,
        });
      }),
    });
    const parse = (t: string) => {
      const o = JSON.parse(t); // 'lixo' lança
      return o.v;
    };

    const out = await rec.runParsed(client, req, ctx, parse);

    expect(out).toBe(1);
    expect(rows).toHaveLength(2);
    expect(rows[0].status).toBe('discarded');
    expect(rows[0].attempt).toBe(1);
    expect(rows[1].status).toBe('ok');
    expect(rows[1].attempt).toBe(2);
  });

  it('run: falha ao gravar o ledger NÃO derruba a chamada (retorna o resultado)', async () => {
    const { prisma } = makePrisma();
    prisma.llmUsage.create = jest.fn().mockRejectedValue(new Error('db down'));
    const rec = new LlmUsageRecorder(prisma);

    const res = await rec.run(fakeClient(), req, ctx);

    expect(res.text).toBe('{"ok":true}'); // trabalho do usuário preservado
  });
});

/**
 * O dono do gasto no ledger (ADR-026 + SPEC-032 §5).
 *
 * **Isto era um bug silencioso.** A coluna `tenant_id` nasceu na Fatia 8 com um
 * backfill único e nada nunca a preencheu depois — toda linha gravada desde
 * então tinha NULL. A policy do `llm_usage` aceita NULL de propósito (histórico
 * órfão pertence ao tenant ativo, decisão F4), então nada quebrou e ninguém viu.
 * O caso em que deixa de ser inofensivo é o desta fatia: o pipeline roda SEM
 * SESSÃO, e uma linha NULL faria o gasto do briefing de um tenant ser somado no
 * teto de qualquer um que olhasse.
 */
describe('LlmUsageRecorder: dono do gasto', () => {
  it('resolve o tenant a partir do projeto quando o chamador não informa', async () => {
    // É o caminho do `insight`: todo chamador dele passa `projectId`, então
    // nenhum precisou mudar para a correção valer.
    const { prisma, rows } = makePrisma('tenant-do-projeto');
    const rec = new LlmUsageRecorder(prisma);

    await rec.run(fakeClient(), req, { projectId: 'p1', kind: 'summary' });

    expect(rows[0].tenantId).toBe('tenant-do-projeto');
  });

  it('o tenantId explícito vence o do projeto', async () => {
    const { prisma, rows } = makePrisma('tenant-do-projeto');
    const rec = new LlmUsageRecorder(prisma);

    await rec.run(fakeClient(), req, {
      projectId: 'p1',
      tenantId: 'tenant-explicito',
      kind: 'summary',
    });

    expect(rows[0].tenantId).toBe('tenant-explicito');
  });

  it('grava o tenant sem projectId — o caminho do pipeline anônimo', async () => {
    // O pipeline da SPEC-032 nasce de `ClientProject`, que NÃO é o `Project`
    // (repo do GitHub) do ledger. Sem o tenantId explícito, esta linha seria
    // NULL: o caso exato que a fatia precisa fechar.
    const { prisma, rows } = makePrisma();
    const rec = new LlmUsageRecorder(prisma);

    await rec.run(fakeClient(), req, {
      projectId: null,
      tenantId: 't-1',
      kind: 'artifact_scope',
    });

    expect(rows[0].tenantId).toBe('t-1');
    expect(rows[0].projectId).toBeNull();
  });

  it('grava o artifactRunId quando informado', async () => {
    // §5: "quanto custou este briefing" responde por consulta ao LEDGER, sem
    // derivar de ArtifactVersion (ADR-016).
    const { prisma, rows } = makePrisma();
    const rec = new LlmUsageRecorder(prisma);

    await rec.run(fakeClient(), req, {
      projectId: null,
      tenantId: 't-1',
      artifactRunId: 'run-1',
      kind: 'artifact_scope',
    });

    expect(rows[0].artifactRunId).toBe('run-1');
  });

  it('sem projeto e sem tenant explícito, grava NULL em vez de estourar', async () => {
    // Regra de ouro do recorder: o ledger nunca derruba a chamada. Linha sem
    // tenant é ruim; perder o trabalho que o usuário pediu é pior.
    const { prisma, rows } = makePrisma();
    const rec = new LlmUsageRecorder(prisma);

    await rec.run(fakeClient(), req, { projectId: null, kind: 'avulso' });

    expect(rows[0].tenantId).toBeNull();
  });

  it('projeto inexistente não derruba a gravação', async () => {
    const { prisma, rows } = makePrisma(null);
    const rec = new LlmUsageRecorder(prisma);

    await rec.run(fakeClient(), req, { projectId: 'sumiu', kind: 'summary' });

    expect(rows[0].tenantId).toBeNull();
    expect(rows).toHaveLength(1);
  });

  it('cada tentativa do runParsed carrega o mesmo dono', async () => {
    // §5: "inclusive as que falharam e os retries descartados". Uma linha de
    // descarte sem tenant seria gasto real fora da soma de alguém.
    const { prisma, rows } = makePrisma();
    const rec = new LlmUsageRecorder(prisma);

    await expect(
      rec.runParsed(
        fakeClient(),
        req,
        { projectId: null, tenantId: 't-1', artifactRunId: 'run-1', kind: 'artifact_scope' },
        () => {
          throw new Error('schema inválido');
        },
      ),
    ).rejects.toThrow('schema inválido');

    expect(rows).toHaveLength(2); // as duas tentativas
    rows.forEach((r) => {
      expect(r.tenantId).toBe('t-1');
      expect(r.artifactRunId).toBe('run-1');
      expect(r.status).toBe('discarded');
    });
  });
});
