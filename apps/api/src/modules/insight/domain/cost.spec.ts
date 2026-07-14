import { Prisma } from '@prisma/client';
import { computeCost, Tariffs } from './cost';

const D = Prisma.Decimal;

// Tarifas do claude-sonnet-5 (seed): input 3, output 15, write 3.75, read 0.30.
const anthropicTariffs: Tariffs = {
  inputPer1M: new D('3'),
  outputPer1M: new D('15'),
  cacheWritePer1M: new D('3.75'),
  cacheReadPer1M: new D('0.30'),
};

const noCache = { cacheCreationTokens: 0, cacheReadTokens: 0 };

describe('computeCost — cálculo de custo em Decimal (SPEC-009)', () => {
  it('Anthropic: cada componente usa a tarifa própria (input ≠ output ≠ cache)', () => {
    const r = computeCost(
      { inputTokens: 1000, outputTokens: 500, cacheCreationTokens: 200, cacheReadTokens: 800 },
      anthropicTariffs,
      undefined,
    );
    // input: 3/1M*1000 = 0.003 · output: 15/1M*500 = 0.0075
    // write: 3.75/1M*200 = 0.00075 · read: 0.30/1M*800 = 0.00024
    // total = 0.01149
    expect(r.costSource).toBe('table');
    expect(r.priceMissing).toBe(false);
    expect(r.costUsd!.toString()).toBe('0.01149');
    expect(r.priceSnapshot).toEqual({
      inputPer1M: '3', outputPer1M: '15', cacheWritePer1M: '3.75', cacheReadPer1M: '0.3',
    });
  });

  it('OpenAI: cache write não é cobrado (tarifa 0), só read — o erro clássico é reusar a de input', () => {
    const openaiTariffs: Tariffs = {
      inputPer1M: new D('2.50'),
      outputPer1M: new D('10'),
      cacheWritePer1M: new D('0'), // OpenAI não cobra write
      cacheReadPer1M: new D('1.25'),
    };
    const r = computeCost(
      { inputTokens: 1000, outputTokens: 0, cacheCreationTokens: 999, cacheReadTokens: 400 },
      openaiTariffs,
      undefined,
    );
    // input 0.0025 + write 0 (mesmo com 999 tokens) + read 1.25/1M*400 = 0.0005 = 0.003
    expect(r.costUsd!.toString()).toBe('0.003');
    expect(r.costSource).toBe('table');
  });

  it('OpenRouter: custo do provedor VENCE a tabela (costSource provider, ignora ModelPrice)', () => {
    const r = computeCost(
      { inputTokens: 1000, outputTokens: 500, ...noCache },
      anthropicTariffs, // mesmo com tarifa cadastrada...
      0.0042, // ...o custo do provedor vence
    );
    expect(r.costSource).toBe('provider');
    expect(r.costUsd!.toString()).toBe('0.0042');
    expect(r.priceSnapshot).toBeNull(); // não congela tarifa quando é fato do provedor
  });

  it('sem tarifa cadastrada → costSource none, priceMissing, costUsd null (nunca zero)', () => {
    const r = computeCost({ inputTokens: 5000, outputTokens: 2000, ...noCache }, null, undefined);
    expect(r.costSource).toBe('none');
    expect(r.priceMissing).toBe(true);
    expect(r.costUsd).toBeNull();
  });

  it('custo de fração de centavo não perde precisão (Decimal, não Float)', () => {
    // 1 token de input a 3/1M = 0.000003 — Float acumularia erro com milhares desses.
    const r = computeCost({ inputTokens: 1, outputTokens: 0, ...noCache }, anthropicTariffs, undefined);
    expect(r.costUsd!.toString()).toBe('0.000003');
  });
});
