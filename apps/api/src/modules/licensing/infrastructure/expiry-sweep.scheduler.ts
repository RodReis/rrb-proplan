import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import type { Queue } from 'bullmq';
import {
  EXPIRY_SWEEP_CRON,
  EXPIRY_SWEEP_JOB,
  LICENSING_QUEUE,
} from '../licensing.constants';

/**
 * Registra o sweep diário que materializa `EXPIRED` (SPEC-048, ADR-029).
 *
 * ## O que este agendamento NÃO faz
 *
 * Ele não passa a decidir expiração. Uma licença vencida já responde `410` em
 * `/activate` e `/heartbeat` desde o instante exato do vencimento, tenha o sweep
 * rodado ou não — a SPEC-038 é explícita em que *"job diário atrasado ou morto
 * não pode conceder acesso"*, e ligá-lo aqui não altera isso em nenhum sentido.
 *
 * O que ele conserta é o desencontro entre a tela e o comportamento: sem ele o
 * admin lê `ACTIVE` numa linha que as rotas já recusam. É a razão de este ser o
 * job mais inofensivo do módulo — pode morrer por semanas sem afetar acesso
 * nenhum, e o pior caso é uma lista desatualizada.
 */
@Injectable()
export class ExpirySweepScheduler implements OnModuleInit {
  private readonly logger = new Logger(ExpirySweepScheduler.name);

  constructor(@InjectQueue(LICENSING_QUEUE) private readonly queue: Queue) {}

  /**
   * Registra (ou atualiza) o agendamento no boot.
   *
   * Mesmo contrato dos outros dois schedulers do módulo: id fixo para o registro
   * ser idempotente (ADR-029, decisão 3) e `try/catch` que loga sem derrubar o
   * boot. Aqui a tolerância a falha é ainda mais confortável que nos demais —
   * `updateMany` de estado que a validação já aplica sozinha.
   */
  async onModuleInit(): Promise<void> {
    try {
      await this.queue.upsertJobScheduler(
        EXPIRY_SWEEP_JOB,
        { pattern: EXPIRY_SWEEP_CRON },
        { name: EXPIRY_SWEEP_JOB, data: {} },
      );
      this.logger.log(`Sweep diário de expiração agendado (${EXPIRY_SWEEP_CRON})`);
    } catch (erro) {
      const motivo = erro instanceof Error ? erro.message : String(erro);
      this.logger.warn(`Não foi possível agendar o sweep de expiração: ${motivo}`);
    }
  }
}
