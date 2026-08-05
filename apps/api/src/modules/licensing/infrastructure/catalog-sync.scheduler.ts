import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { CATALOG_SYNC_CRON, CATALOG_SYNC_JOB, LICENSING_QUEUE } from '../licensing.constants';

/**
 * Registra o sync diário do catálogo na fila (SPEC-047, ADR-029).
 *
 * ## Por que um provider só para registrar
 *
 * O ADR-029 fixou que **todo repeatable do repo entra por este mecanismo** e que
 * o registro é idempotente por chave estável. Concentrar o agendamento num
 * arquivo próprio é o que torna a promessa verificável: quem procurar *"o que
 * roda sozinho neste repo"* acha os provider que implementam `OnModuleInit` e
 * chamam `upsertJobScheduler` — e não um `repeat:` escondido dentro de um
 * service de negócio.
 *
 * **Este arquivo não sabe sincronizar nada.** Ele agenda; quem executa é o
 * worker. Separar os dois é o que permite ao botão chamar o mesmo fluxo sem
 * passar pela fila.
 */
@Injectable()
export class CatalogSyncScheduler implements OnModuleInit {
  private readonly logger = new Logger(CatalogSyncScheduler.name);

  constructor(@InjectQueue(LICENSING_QUEUE) private readonly queue: Queue) {}

  /**
   * Registra (ou atualiza) o agendamento no boot.
   *
   * `upsertJobScheduler` com id fixo é a API que o BullMQ oferece justamente
   * para isto: chamar N vezes deixa **um** agendamento. Reiniciar a API, subir
   * uma segunda instância ou fazer deploy não podem multiplicar a rodada
   * (ADR-029, decisão 3).
   *
   * **Falha aqui não derruba o boot.** Redis fora do ar no start significaria
   * API que não sobe — e o sync não é caminho de dinheiro: a venda continua
   * entrando pelo webhook. O log conta, e o próximo boot registra.
   */
  async onModuleInit(): Promise<void> {
    try {
      await this.queue.upsertJobScheduler(
        CATALOG_SYNC_JOB,
        { pattern: CATALOG_SYNC_CRON },
        { name: CATALOG_SYNC_JOB, data: {} },
      );
      this.logger.log(`Sync diário do catálogo agendado (${CATALOG_SYNC_CRON})`);
    } catch (erro) {
      const motivo = erro instanceof Error ? erro.message : String(erro);
      this.logger.warn(`Não foi possível agendar o sync do catálogo: ${motivo}`);
    }
  }
}
