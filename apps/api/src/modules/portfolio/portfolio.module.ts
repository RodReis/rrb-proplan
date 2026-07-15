import { Module } from '@nestjs/common';
import { CanonicalModule } from '../canonical/canonical.module';
import { SettingsModule } from '../settings/settings.module';
import { PortfolioService } from './application/portfolio.service';
import { PortfolioController } from './presentation/portfolio.controller';

/**
 * Portfólio + Radar (SPEC-019, Fatia 14). View cross-projeto sobre os sinais já
 * entregues (staleness, cobertura, deploy, CI) — projeção de leitura pura, zero
 * IA (ADR-002). Consome Canonical/Settings por interface pública (ADR-001).
 */
@Module({
  imports: [CanonicalModule, SettingsModule],
  controllers: [PortfolioController],
  providers: [PortfolioService],
})
export class PortfolioModule {}
