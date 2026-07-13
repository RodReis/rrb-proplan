import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import {
  SYNC_COMPLETED,
  SyncCompletedEvent,
} from '../../ingestion/application/sync.service';
import { BoardService } from '../application/board.service';

/**
 * Sincroniza o cache de issues sempre que um sync termina (SPEC-005:
 * "botão Sincronizar cobre mudanças feitas direto no GitHub"). Tolerante a
 * falha — Issues desabilitada, sem instalação ou erro de rede não podem
 * derrubar o sync de docs.
 */
@Injectable()
export class BoardSyncListener {
  private readonly logger = new Logger(BoardSyncListener.name);

  constructor(private readonly board: BoardService) {}

  @OnEvent(SYNC_COMPLETED)
  async onSyncCompleted(event: SyncCompletedEvent): Promise<void> {
    try {
      await this.board.syncIssues(event.projectId);
    } catch (err) {
      this.logger.warn(
        `Sync de issues do projeto ${event.projectId} falhou (não bloqueia docs): ${
          err instanceof Error ? err.message : err
        }`,
      );
    }
  }
}
