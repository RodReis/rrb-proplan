import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { SettingsModule } from '../settings/settings.module';
import { IngestionModule } from '../ingestion/ingestion.module';
import { InsightService } from './application/insight.service';
import { LlmUsageRecorder } from './application/llm-usage.recorder';
import { UsageService } from './application/usage.service';
import { AnthropicClient } from './infrastructure/anthropic.client';
import { LlmClientFactory } from './infrastructure/llm-client.factory';
import {
  InsightEventListener,
  InsightWorker,
} from './infrastructure/insight.worker';
import { INSIGHT_QUEUE } from './insight.constants';
import { InsightController } from './presentation/insight.controller';
import { UsageController } from './presentation/usage.controller';

@Module({
  imports: [
    SettingsModule,
    IngestionModule,
    BullModule.registerQueue({ name: INSIGHT_QUEUE }),
  ],
  controllers: [InsightController, UsageController],
  providers: [
    InsightService,
    LlmUsageRecorder,
    UsageService,
    LlmClientFactory,
    AnthropicClient,
    InsightEventListener,
    InsightWorker,
  ],
  exports: [InsightService, UsageService],
})
export class InsightModule {}
