import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import {
  SYNC_COMPLETED,
  SyncCompletedEvent,
} from '../../ingestion/application/sync.service';
import { ContextService } from '../../context/application/context.service';
import { CanonicalService } from '../application/canonical.service';

/**
 * Repopula o modelo canônico ao fim de todo sync (success e noop), via evento —
 * ingestion NÃO conhece canonical (ADR-001, desacoplamento por evento, ADR-004).
 * Determinístico, sem IA: não passa por BullMQ nem pelo teto da SPEC-009.
 *
 * Ordem deliberada (SPEC-015): as asserções são reconstruídas ANTES do modelo
 * canônico — `constraints` é projeção sobre Assertion; dois listeners
 * independentes correriam (EventEmitter2 não garante ordem entre async).
 * Falha no context não derruba o canonical: as 6 entidades seguem, e o
 * constraints usa o índice anterior (reconstruível no próximo sync).
 */
@Injectable()
export class CanonicalListener {
  private readonly logger = new Logger(CanonicalListener.name);

  constructor(
    private readonly canonical: CanonicalService,
    private readonly context: ContextService,
  ) {}

  @OnEvent(SYNC_COMPLETED)
  async onSyncCompleted(event: SyncCompletedEvent): Promise<void> {
    try {
      await this.context.rebuild(event.projectId);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'erro';
      this.logger.warn(
        `Rebuild das asserções falhou (projeto ${event.projectId}): ${message}`,
      );
    }
    try {
      await this.canonical.rebuild(event.projectId);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'erro';
      this.logger.warn(
        `Rebuild do modelo canônico falhou (projeto ${event.projectId}): ${message}`,
      );
    }
  }
}
