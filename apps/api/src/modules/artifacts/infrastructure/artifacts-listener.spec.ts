import type { Queue } from 'bullmq';
import type { PrismaService } from '../../../prisma/prisma.service';
import type { UsageService } from '../../llm';
import type { BriefingSubmittedEvent } from '../../briefing/application/briefing-submit.service';
import { ArtifactsEventListener, type ArtifactsJobData } from './artifacts.worker';

const evento: BriefingSubmittedEvent = {
  clientProjectId: 'cp-1',
  briefingVersionId: 'bv-1',
  tenantId: 't-1',
};

function montar(podeGastar: boolean, runsExistentes = 0, contagemFalha = false) {
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
  const prisma = {
    runInTenantContext: jest.fn(async (tenantIds: string[], fn: () => Promise<number>) => {
      // O listener também não tem request: sem contexto o RLS devolveria zero e
      // a chave voltaria a colidir. O mock recusa tenant inesperado em vez de
      // aceitar qualquer coisa.
      if (tenantIds[0] !== 't-1') throw new Error(`tenantId inesperado: ${tenantIds[0]}`);
      return fn();
    }),
    artifactRun: {
      count: jest.fn(async () => {
        if (contagemFalha) throw new Error('db fora');
        return runsExistentes;
      }),
    },
  } as unknown as PrismaService;

  return {
    listener: new ArtifactsEventListener(queue, usage, prisma),
    queue,
    usage,
    prisma,
  };
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

  it('usa jobId por (briefing, tentativa) — 1ª barreira de idempotência', async () => {
    // §2.8: o BullMQ recusa id repetido enquanto o job existir na fila. É a
    // barreira barata, antes de qualquer gasto.
    const { listener, queue } = montar(true);

    await listener.onBriefingSubmitted(evento);

    const [, , opts] = (queue.add as jest.Mock).mock.calls[0];
    expect(opts.jobId).toBe('briefing_bv-1_1');
  });

  it('com run anterior, a chave muda — re-disparo não é engolido', async () => {
    // O bug que este caso fecha, encontrado no dogfooding: com o id fixo em
    // `briefing_<id>`, o job de um run que FALHOU continuava em `completed` no
    // Redis (`removeOnComplete: 50`), e o `add` seguinte era descartado EM
    // SILÊNCIO — nada no log, nada no banco. O briefing ficava sem gatilho.
    const { listener, queue } = montar(true, 1);

    await listener.onBriefingSubmitted(evento);

    const [, , opts] = (queue.add as jest.Mock).mock.calls[0];
    expect(opts.jobId).toBe('briefing_bv-1_2');
  });

  it('conta as execuções DENTRO do contexto do tenant', async () => {
    // O listener não tem request. Contar sem contexto devolveria zero sob RLS
    // fail-closed, e a chave voltaria a colidir — o mesmo bug, outra causa.
    const { listener, prisma } = montar(true, 2);

    await listener.onBriefingSubmitted(evento);

    expect(prisma.runInTenantContext).toHaveBeenCalledWith(
      ['t-1'],
      expect.any(Function),
    );
  });

  it('falha ao contar não impede o enfileiramento', async () => {
    // Barrar o pipeline porque a query de um detalhe de fila falhou seria
    // trocar um problema pequeno por um grande. Cai num fallback que garante
    // chave única ao custo de perder a numeração legível.
    const { listener, queue } = montar(true, 0, true);

    await listener.onBriefingSubmitted(evento);

    expect(queue.add).toHaveBeenCalledTimes(1);
    const [, , opts] = (queue.add as jest.Mock).mock.calls[0];
    expect(opts.jobId).toMatch(/^briefing_bv-1_\d+$/);
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
