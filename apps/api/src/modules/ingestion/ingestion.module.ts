import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { IdentityModule } from '../identity/identity.module';
import { IngestionService } from './application/ingestion.service';
import { LinkService } from './application/link.service';
import { ResolutionService } from './application/resolution.service';
import { SyncService } from './application/sync.service';
import { GithubGitClient } from './infrastructure/github-git.client';
import { SyncWorker } from './infrastructure/sync.worker';
import { SYNC_QUEUE } from './ingestion.constants';
import { IngestionController } from './presentation/ingestion.controller';

@Module({
  imports: [IdentityModule, BullModule.registerQueue({ name: SYNC_QUEUE })],
  controllers: [IngestionController],
  providers: [
    IngestionService,
    SyncService,
    LinkService,
    ResolutionService,
    GithubGitClient,
    SyncWorker,
  ],
  exports: [IngestionService, ResolutionService],
})
export class IngestionModule {}
