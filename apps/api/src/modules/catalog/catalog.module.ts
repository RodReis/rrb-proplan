import { Module } from '@nestjs/common';
import { IdentityModule } from '../identity/identity.module';
import { IngestionModule } from '../ingestion/ingestion.module';
import { SettingsModule } from '../settings/settings.module';
import { CatalogService } from './application/catalog.service';
import { GithubClient } from './infrastructure/github.client';
import { CatalogController } from './presentation/catalog.controller';
import { FreshnessController } from './presentation/freshness.controller';
import { ResolveController } from './presentation/resolve.controller';

@Module({
  imports: [IdentityModule, IngestionModule, SettingsModule],
  controllers: [CatalogController, FreshnessController, ResolveController],
  providers: [CatalogService, GithubClient],
})
export class CatalogModule {}
