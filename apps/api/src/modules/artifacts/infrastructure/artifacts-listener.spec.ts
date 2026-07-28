import type { Queue } from 'bullmq';
import type { UsageService } from '../../llm';
import type { BriefingSubmittedEvent } from '../../briefing/application/briefing-submit.service';
import { ArtifactsEventListener, type ArtifactsJobData } from './artifacts.worker';

const evento: BriefingSubmittedEvent = {
  clientProjectId: 'cp-1',
  briefingVersionId: 'bv-1',
  tenantId: 't-1',
};

function montar(podeGastar: boolean) {
  const queue = { add: jest.fn() } as unknown as Queue<ArtifactsJobData>;
  // O mock RECUSA um tenantId inesperado em vez de devolver o mesmo valor para
  // qualquer argumento. Foi exatamente essa frouxidão que fez a suíte do #158
  // ficar verde sem nunca afirmar de QUEM era o teto.
  const usage = {
    canSpendForTenant: jest.fn(async (tenantId: string) => {
      if (tenantId !== 't-1') {
        throw new Error(`tenantId inesperado: ${tenantId}`);
      }
      return podeGastar;
    }),
  } as unknown as UsageService;
  return { listener: new ArtifactsEventListener(queue, usage), queue, usage };
}

describe('ArtifactsEventListener: gatilho do pipeline (SPEC-032 §2.1)', () => {
  it('enfileira o job quando há teto disponível', async () => {
    const { listener, queue } = montar(true);

    await listener.onBriefingSubmitted(evento);

    expect(queue.add).toHaveBeenCalledTimes(1);
    const [nome, data] = (queue.add as jest.Mock).mock.calls[0];
    expect(nome).toBe('pipeline');
    expect(data).toEqual({
      clientProjectId: 'cp-1',
      briefingVersionId: 'bv-1',
      tenantId: 't-1',
    });
  });

  it('o tenant vai NO JOB — sem ele o worker não tem contexto RLS', async () => {
    // §7.3: o job não tem request. Se o tenant não viajar no payload, o worker
    // roda sem contexto e toda query devolve ZERO LINHAS, silenciosamente.
    const { listener, queue } = montar(true);

    await listener.onBriefingSubmitted(evento);

    const [, data] = (queue.add as jest.Mock).mock.calls[0];
    expect((data as ArtifactsJobData).tenantId).toBe('t-1');
  });

  it('NÃO enfileira quando o teto do tenant está estourado', async () => {
    // Critério de aceite do §5: "com teto estourado, o job não é enfileirado
    // e o briefing continua íntegro". Barrar ANTES de enfileirar é o que
    // impede o gasto — barrar depois já teria pago o modelo.
    const { listener, queue } = montar(false);

    await listener.onBriefingSubmitted(evento);

    expect(queue.add).not.toHaveBeenCalled();
  });

  it('consulta o teto POR TENANT, nunca por usuário', async () => {
    // O caminho é anônimo: o briefing vem de um cliente sem sessão. `capsOf` a
    // partir de `userId` é literalmente inalcançável daqui — é para este
    // chamador que o ADR-026 existe.
    const { listener, usage } = montar(true);

    await listener.onBriefingSubmitted(evento);

    expect(usage.canSpendForTenant).toHaveBeenCalledWith('t-1');
  });

  it('usa jobId derivado da versão do briefing (1ª barreira de idempotência)', async () => {
    // §2.8: o BullMQ recusa id repetido enquanto o job existir na fila. É a
    // barreira barata, antes de qualquer gasto — a definitiva é o `inputHash`
    // no banco, que vale mesmo depois do `removeOnComplete`.
    const { listener, queue } = montar(true);

    await listener.onBriefingSubmitted(evento);

    const [, , opts] = (queue.add as jest.Mock).mock.calls[0];
    expect(opts.jobId).toBe('briefing_bv-1');
  });

  it('configura UMA retentativa, não o padrão da fila', async () => {
    // Decisão 6 do PI (§8): `attempts: 2` = a original + 1 retry. Cobre o 429
    // passageiro; a segunda retentativa já seria gastar de novo numa falha que
    // pode ser estrutural, e aí a decisão volta a ser humana.
    const { listener, queue } = montar(true);

    await listener.onBriefingSubmitted(evento);

    const [, , opts] = (queue.add as jest.Mock).mock.calls[0];
    expect(opts.attempts).toBe(2);
    expect(opts.backoff).toEqual({ type: 'exponential', delay: 5000 });
  });
});
