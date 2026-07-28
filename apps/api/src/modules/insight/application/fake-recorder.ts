import { LlmUsageRecorder } from '../../llm/application/llm-usage.recorder';
import { UsageService } from '../../llm/application/usage.service';

/** Gate de teto fake que sempre permite gastar (para specs que não testam o teto). */
export function fakeUsageGate(): UsageService {
  return {
    async canSpend() {
      return true;
    },
    async canSpendForUser() {
      return true;
    },
    async canSpendForTenant() {
      return true;
    },
  } as unknown as UsageService;
}

/**
 * Recorder fake para os specs do InsightService: replica o comportamento
 * observável (chama o client, aplica o parse, faz o retry) SEM tocar no banco.
 * Assim os testes de comportamento seguem valendo sem mockar o ledger inteiro.
 * Os testes do próprio ledger vivem em llm-usage.recorder / cost specs.
 */
export function fakeRecorder(): LlmUsageRecorder {
  return {
    async run(client: any, req: any) {
      return client.complete(req);
    },
    async runParsed(client: any, req: any, _ctx: any, parse: any, maxAttempts = 2) {
      let lastErr: unknown;
      for (let i = 0; i < maxAttempts; i++) {
        const res = await client.complete(req);
        try {
          return parse(res.text, res);
        } catch (err) {
          lastErr = err;
        }
      }
      throw lastErr;
    },
    async recordDiscarded() {},
  } as unknown as LlmUsageRecorder;
}
