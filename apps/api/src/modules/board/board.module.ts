import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { IdentityModule } from '../identity/identity.module';
import { InsightModule } from '../insight/insight.module';
import { SharedModule } from '../../shared/shared.module';
import { BoardService } from './application/board.service';
import { BoardMutationService } from './application/board-mutation.service';
import { BoardImportService } from './application/board-import.service';
import { MutationApplierService } from './application/mutation-applier.service';
import { ProjectionService } from './application/projection.service';
import { BOARD_QUEUE } from './board.constants';
import { GithubIssuesClient } from './infrastructure/github-issues.client';
import { BoardWorker } from './infrastructure/board.worker';
import { BoardSyncListener } from './infrastructure/board-sync.listener';
import { BoardController } from './presentation/board.controller';

@Module({
  imports: [
    IdentityModule,
    InsightModule,
    SharedModule,
    BullModule.registerQueue({ name: BOARD_QUEUE }),
  ],
  controllers: [BoardController],
  providers: [
    BoardService,
    BoardMutationService,
    BoardImportService,
    MutationApplierService,
    ProjectionService,
    GithubIssuesClient,
    BoardWorker,
    BoardSyncListener,
  ],
  exports: [BoardService],
})
export class BoardModule {}
