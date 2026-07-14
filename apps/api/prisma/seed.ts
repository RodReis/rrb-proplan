import { PrismaClient } from '@prisma/client';

/**
 * Seed de dados de desenvolvimento (CLAUDE.md: sem hardcode/mock — dado local
 * entra por aqui). Idempotente: rodar de novo não duplica.
 *
 * `ModelPrice` (SPEC-009): preço por 1M tokens, em USD. Fonte anotada no campo
 * `source`. OpenRouter não precisa de preço (usa costSource: provider), mas
 * seedamos por completude. Cache write da OpenAI = 0 (não cobra).
 */
const prisma = new PrismaClient();

const EPOCH = new Date('2026-01-01T00:00:00Z'); // effectiveFrom fixo (idempotência)

const PRICES = [
  {
    provider: 'anthropic',
    model: 'claude-sonnet-5',
    inputPer1M: '3',
    outputPer1M: '15',
    cacheWritePer1M: '3.75',
    cacheReadPer1M: '0.30',
    source: 'anthropic.com/pricing (Sonnet — 2026-07)',
  },
  {
    provider: 'openai',
    model: 'gpt-4o',
    inputPer1M: '2.50',
    outputPer1M: '10',
    cacheWritePer1M: '0', // OpenAI não cobra cache write
    cacheReadPer1M: '1.25',
    source: 'openai.com/pricing (gpt-4o — 2026-07)',
  },
];

async function main() {
  for (const p of PRICES) {
    await prisma.modelPrice.upsert({
      where: {
        provider_model_effectiveFrom: {
          provider: p.provider,
          model: p.model,
          effectiveFrom: EPOCH,
        },
      },
      update: {
        inputPer1M: p.inputPer1M,
        outputPer1M: p.outputPer1M,
        cacheWritePer1M: p.cacheWritePer1M,
        cacheReadPer1M: p.cacheReadPer1M,
        source: p.source,
      },
      create: { ...p, effectiveFrom: EPOCH },
    });
    console.log(`ModelPrice seed: ${p.provider}/${p.model}`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
