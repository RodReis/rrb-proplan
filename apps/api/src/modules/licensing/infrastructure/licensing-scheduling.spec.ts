import type { Job, Queue } from 'bullmq';
import type { PrismaService } from '../../../prisma/prisma.service';
import type { CatalogSyncService } from '../application/catalog-sync.service';
import type { LicenseExpirySweepService } from '../application/license-expiry-sweep.service';
import type { SourceInviteService } from '../application/source-invite.service';
import type { WebhookProcessorService } from '../application/webhook-processor.service';
import {
  EXPIRY_SWEEP_CRON,
  EXPIRY_SWEEP_JOB,
  SOURCE_RECONCILE_CRON,
  SOURCE_RECONCILE_JOB,
} from '../licensing.constants';
import { ExpirySweepScheduler } from './expiry-sweep.scheduler';
import { LicensingWorker } from './licensing.worker';
import { SourceReconcileScheduler } from './source-reconcile.scheduler';

/**
 * O agendamento do convite e da expiração (SPEC-048, ADR-029).
 *
 * O que este arquivo protege são os modos de falhar **em silêncio** desta fatia:
 *
 * 1. **Registro não idempotente.** Sem `upsertJobScheduler` com id fixo, cada
 *    boot somaria uma rodada — e duas instâncias no Railway já bastariam para
 *    duas rodadas disputarem a mesma transição `PENDING → INVITED`.
 * 2. **Boot derrubado por Redis.** Um `throw` no `onModuleInit` significa API que
 *    não sobe porque a fila está fora — trocando "um convite atrasa" por "o
 *    produto inteiro cai".
 * 3. **Rodada fora de `runInTenantContext`.** O RLS é fail-closed: sem contexto o
 *    `reconcile` lê ZERO LINHAS **sem erro**, e a rodada reporta sucesso tendo
 *    feito nada.
 * 4. **Um tenant quebrado derrubando os demais.** O sintoma seria "o convite de
 *    alguns nunca sai", sem nada em log ligando um caso ao outro.
 */
describe('SPEC-048: registro dos recorrentes', () => {
  function filaDobrada(falha?: Error) {
    const chamadas: Array<{ id: string; repeat: unknown; opts: unknown }> = [];
    const queue = {
      upsertJobScheduler: jest.fn(async (id: string, repeat: unknown, opts: unknown) => {
        if (falha) throw falha;
        chamadas.push({ id, repeat, opts });
        return {};
      }),
    } as unknown as Queue;
    return { queue, chamadas };
  }

  it('a reconciliação registra com id fixo e o cron da spec', async () => {
    const { queue, chamadas } = filaDobrada();

    await new SourceReconcileScheduler(queue).onModuleInit();

    // O id é a chave da idempotência: `upsertJobScheduler` deduplica por ele, e
    // é isso que faz reiniciar a API ou subir uma segunda instância deixarem
    // **um** agendamento (ADR-029, decisão 3).
    expect(chamadas).toEqual([
      {
        id: SOURCE_RECONCILE_JOB,
        repeat: { pattern: SOURCE_RECONCILE_CRON },
        opts: { name: SOURCE_RECONCILE_JOB, data: {} },
      },
    ]);
  });

  it('o sweep registra com id fixo e o cron da spec', async () => {
    const { queue, chamadas } = filaDobrada();

    await new ExpirySweepScheduler(queue).onModuleInit();

    expect(chamadas).toEqual([
      {
        id: EXPIRY_SWEEP_JOB,
        repeat: { pattern: EXPIRY_SWEEP_CRON },
        opts: { name: EXPIRY_SWEEP_JOB, data: {} },
      },
    ]);
  });

  it('os três recorrentes do módulo rodam em horários distintos', () => {
    // A spec não exige horário nenhum — exige que **não coincidam**. O
    // `concurrency: 1` já serializa a execução, mas serialização não é o ponto:
    // horários distintos são o que permite ler "a rodada das 4h falhou" sem
    // desembaraçar três execuções do mesmo minuto.
    const crons = ['0 3 * * *', SOURCE_RECONCILE_CRON, EXPIRY_SWEEP_CRON];
    expect(new Set(crons).size).toBe(3);
  });

  it('Redis fora do ar no boot NÃO derruba a API', async () => {
    const { queue } = filaDobrada(new Error('ECONNREFUSED'));

    // Lançar aqui significaria API que não sobe porque a fila está fora — e
    // nada de acesso depende destas rodadas: o que decide acesso mora na
    // validação. O log conta, e o próximo boot registra.
    await expect(
      new SourceReconcileScheduler(queue).onModuleInit(),
    ).resolves.toBeUndefined();
    await expect(new ExpirySweepScheduler(queue).onModuleInit()).resolves.toBeUndefined();
  });
});

describe('SPEC-048: roteamento e isolamento no worker', () => {
  function montar(opcoes: { reconcileFalha?: string; sweepFalha?: string } = {}) {
    const contextos: string[][] = [];
    const prisma = {
      runInTenantContext: jest.fn((ids: string[], fn: () => unknown) => {
        contextos.push(ids);
        return fn();
      }),
    } as unknown as PrismaService;

    const reconciliados: string[] = [];
    const invites = {
      tenantsComSource: jest.fn(async () => ['tn-1', 'tn-2']),
      reconcile: jest.fn(async (tenantId: string) => {
        if (opcoes.reconcileFalha === tenantId) throw new Error('PAT expirado');
        reconciliados.push(tenantId);
        return { convidados: 1, aceitos: 0, falhas: 0, aguardandoUsername: 0 };
      }),
    } as unknown as SourceInviteService;

    const varridos: string[] = [];
    const expiry = {
      tenantsComLicenca: jest.fn(async () => ['tn-1', 'tn-2']),
      sweep: jest.fn(async (tenantId: string) => {
        if (opcoes.sweepFalha === tenantId) throw new Error('banco fora');
        varridos.push(tenantId);
        return 0;
      }),
    } as unknown as LicenseExpirySweepService;

    const processor = { process: jest.fn() } as unknown as WebhookProcessorService;
    const catalogSync = {
      tenantsConfigurados: jest.fn(async () => []),
      sincronizar: jest.fn(),
    } as unknown as CatalogSyncService;

    return {
      worker: new LicensingWorker(prisma, processor, catalogSync, invites, expiry),
      contextos,
      reconciliados,
      varridos,
      invites,
      expiry,
      processor,
      catalogSync,
    };
  }

  const job = (name: string) => ({ id: 'j1', name, data: {} }) as unknown as Job;

  it('roteia `source-reconcile` para a reconciliação, um tenant por vez', async () => {
    const c = montar();

    await c.worker.process(job(SOURCE_RECONCILE_JOB));

    expect(c.reconciliados).toEqual(['tn-1', 'tn-2']);
    // Não pode cair no processamento de webhook: o `job.data` de um recorrente
    // não tem `webhookEventId`, e o sintoma seria um "evento processado" que não
    // achou nada.
    expect(c.processor.process).not.toHaveBeenCalled();
  });

  it('a reconciliação roda DENTRO do contexto de cada tenant', async () => {
    const c = montar();

    await c.worker.process(job(SOURCE_RECONCILE_JOB));

    // O `reconcile` documenta que é chamado já dentro do contexto. Sem isto o
    // RLS fail-closed devolveria zero linhas sem erro — rodada "bem-sucedida"
    // que não convidou ninguém, e nenhum log dizendo por quê.
    expect(c.contextos).toEqual([['tn-1'], ['tn-2']]);
  });

  it('um tenant com PAT quebrado não impede a rodada dos demais', async () => {
    const c = montar({ reconcileFalha: 'tn-1' });

    await c.worker.process(job(SOURCE_RECONCILE_JOB));

    expect(c.reconciliados).toEqual(['tn-2']);
  });

  it('roteia `expiry-sweep` e deixa o contexto para o service', async () => {
    const c = montar();

    await c.worker.process(job(EXPIRY_SWEEP_JOB));

    expect(c.varridos).toEqual(['tn-1', 'tn-2']);
    // O `sweep` abre o próprio `runInTenantContext` — envolver de novo aqui
    // aninharia contexto sem necessidade. A assimetria com o `reconcile` é dos
    // services, não do worker.
    expect(c.contextos).toEqual([]);
  });

  it('um tenant que falha no sweep não impede os demais', async () => {
    const c = montar({ sweepFalha: 'tn-1' });

    await c.worker.process(job(EXPIRY_SWEEP_JOB));

    expect(c.varridos).toEqual(['tn-2']);
  });
});
