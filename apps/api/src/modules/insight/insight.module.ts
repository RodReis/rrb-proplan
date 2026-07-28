import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { IdentityModule } from '../identity/identity.module';
import { LlmModule } from '../llm';
import { SettingsModule } from '../settings/settings.module';
import { IngestionModule } from '../ingestion/ingestion.module';
import { InsightService } from './application/insight.service';
import {
  InsightEventListener,
  InsightWorker,
} from './infrastructure/insight.worker';
import { INSIGHT_QUEUE } from './insight.constants';
import { InsightController } from './presentation/insight.controller';

/**
 * O acesso a LLM saiu daqui em 2026-07-27 (SPEC-032 §7.2, pré-requisito 2):
 * porta, adapters, ledger e gate do teto vivem no `LlmModule`, e este módulo
 * passou a ser cliente deles como qualquer outro. O que continua sendo do
 * insight: prompts, `input-hash`, orçamento de contexto.
 */
@Module({
  imports: [
    SettingsModule,
    IngestionModule,
    IdentityModule,
    LlmModule,
    BullModule.registerQueue({ name: INSIGHT_QUEUE }),
  ],
  controllers: [InsightController],
  providers: [InsightService, InsightEventListener, InsightWorker],
  exports: [InsightService],
})
export class InsightModule {}
