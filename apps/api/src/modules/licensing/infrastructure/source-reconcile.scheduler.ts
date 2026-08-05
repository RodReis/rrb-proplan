import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import type { Queue } from 'bullmq';
import {
  LICENSING_QUEUE,
  SOURCE_RECONCILE_CRON,
  SOURCE_RECONCILE_JOB,
} from '../licensing.constants';

/**
 * Registra a reconciliação diária do convite ao source (SPEC-048, ADR-029).
 *
 * ## Por que a rodada diária não é opcional
 *
 * A fatia tem dois gatilhos, e eles cobrem casos diferentes. O gatilho por
 * evento (ao gravar o username) atende quem responde **depois** do 8º dia. Este
 * aqui atende o caso mais comum de todos: quem compra e informa o username no
 * **dia 0** — nesse caminho não existe evento nenhum no dia 8, só o relógio.
 * Sem a rodada diária essa compra ficaria órfã para sempre, que é exatamente o
 * defeito que a SPEC-048 nasceu para consertar.
 *
 * **Este arquivo não sabe convidar ninguém.** Ele agenda; quem executa é o
 * worker, e quem decide é o `SourceInviteService` — com o filtro
 * `sourceInviteAt <= agora` intacto, que é a única guarda do prazo de 8 dias.
 */
@Injectable()
export class SourceReconcileScheduler implements OnModuleInit {
  private readonly logger = new Logger(SourceReconcileScheduler.name);

  constructor(@InjectQueue(LICENSING_QUEUE) private readonly queue: Queue) {}

  /**
   * Registra (ou atualiza) o agendamento no boot.
   *
   * `upsertJobScheduler` com id fixo deixa **um** agendamento por mais vezes que
   * seja chamado — reiniciar a API, fazer deploy ou subir uma segunda instância
   * no Railway não podem dobrar a rodada (ADR-029, decisão 3). E dobrar aqui não
   * seria só desperdício: seriam duas rodadas disputando a mesma transição
   * `PENDING → INVITED`.
   *
   * **Falha aqui não derruba o boot.** Redis fora no start significaria API que
   * não sobe, e nada de acesso depende desta rodada: o que decide acesso mora na
   * validação. O log conta, e o próximo boot registra.
   */
  async onModuleInit(): Promise<void> {
    try {
      await this.queue.upsertJobScheduler(
        SOURCE_RECONCILE_JOB,
        { pattern: SOURCE_RECONCILE_CRON },
        { name: SOURCE_RECONCILE_JOB, data: {} },
      );
      this.logger.log(
        `Reconciliação diária do convite ao source agendada (${SOURCE_RECONCILE_CRON})`,
      );
    } catch (erro) {
      const motivo = erro instanceof Error ? erro.message : String(erro);
      this.logger.warn(`Não foi possível agendar a reconciliação do convite: ${motivo}`);
    }
  }
}
