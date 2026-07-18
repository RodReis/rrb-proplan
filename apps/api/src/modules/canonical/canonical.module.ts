import { Module } from '@nestjs/common';
import { ContextModule } from '../context/context.module';
import { IdentityModule } from '../identity/identity.module';
import { IngestionModule } from '../ingestion/ingestion.module';
import { SettingsModule } from '../settings/settings.module';
import { CanonicalService } from './application/canonical.service';
import { CanonicalListener } from './infrastructure/canonical.listener';
import { CanonicalController } from './presentation/canonical.controller';

/**
 * Modelo canônico (SPEC-014, Fatia 9). Fundação do MVP2 — 100% determinística,
 * zero IA. Consome ResolutionService (cobertura) e SettingsService (limiar) por
 * interface pública (ADR-001). O rebuild dispara por evento de sync (listener),
 * sem ingestion conhecer este módulo.
 */
@Module({
  imports: [IngestionModule, SettingsModule, ContextModule, IdentityModule],
  controllers: [CanonicalController],
  providers: [CanonicalService, CanonicalListener],
  exports: [CanonicalService],
})
export class CanonicalModule {}
