import { Prisma } from '@prisma/client';
import { LlmUsageRecorder } from './llm-usage.recorder';

const PRICE = {
  inputPer1M: new Prisma.Decimal('3'),
  outputPer1M: new Prisma.Decimal('15'),
  cacheWritePer1M: new Prisma.Decimal('3.75'),
  cacheReadPer1M: new Prisma.Decimal('0.30'),
  effectiveFrom: new Date('2026-01-01'),
};

function makePrisma() {
  const rows: any[] = [];
  return {
    rows,
    prisma: {
      modelPrice: { findFirst: jest.fn().mockResolvedValue(PRICE) },
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
