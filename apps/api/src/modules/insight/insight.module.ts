import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { IdentityModule } from '../identity/identity.module';
import { IngestionModule } from '../ingestion/ingestion.module';
import { SettingsModule } from '../settings/settings.module';
import { BootstrapService } from './application/bootstrap.service';
import { InsightService } from './application/insight.service';
import { AnthropicClient } from './infrastructure/anthropic.client';
import { GithubWritebackClient } from './infrastructure/github-writeback.client';
import { LlmClientFactory } from './infrastructure/llm-client.factory';
import {
  InsightEventListener,
  InsightWorker,
} from './infrastructure/insight.worker';
import { INSIGHT_QUEUE } from './insight.constants';
import { InsightController } from './presentation/insight.controller';

@Module({
  imports: [
    IdentityModule,
    SettingsModule,
    IngestionModule,
    BullModule.registerQueue({ name: INSIGHT_QUEUE }),
  ],
  controllers: [InsightController],
  providers: [
    InsightService,
    BootstrapService,
    LlmClientFactory,
    AnthropicClient,
    GithubWritebackClient,
    InsightEventListener,
    InsightWorker,
  ],
  exports: [InsightService],
})
export class InsightModule {}
