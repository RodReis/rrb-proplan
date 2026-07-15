import { Module } from '@nestjs/common';
import { ActivityModule } from '../activity/activity.module';
import { IdentityModule } from '../identity/identity.module';
import { IngestionModule } from '../ingestion/ingestion.module';
import { SharedModule } from '../../shared/shared.module';
import { ContextService } from './application/context.service';
import { ContextController } from './presentation/context.controller';

/**
 * Contexto/asserção humana (SPEC-015, Fatia 10, ADR-013). O cofre versionado do
 * "o que não mexer": captura na UI → write-back em docs/CONTEXT.md → ingestão
 * no sync → validade datada. Zero IA. O rebuild é orquestrado pelo
 * CanonicalListener (asserções antes da projeção `constraints` — ordem
 * determinística, ver canonical.listener.ts).
 */
@Module({
  imports: [IdentityModule, IngestionModule, ActivityModule, SharedModule],
  controllers: [ContextController],
  providers: [ContextService],
  exports: [ContextService],
})
export class ContextModule {}
