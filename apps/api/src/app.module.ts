import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { HealthController } from './health.controller';
import { PrismaModule } from './prisma/prisma.module';
import { IdentityModule } from './modules/identity/identity.module';
import { CatalogModule } from './modules/catalog/catalog.module';
import { IngestionModule } from './modules/ingestion/ingestion.module';
import { InsightModule } from './modules/insight/insight.module';
import { BoardModule } from './modules/board/board.module';
import { SettingsModule } from './modules/settings/settings.module';
import { ActivityModule } from './modules/activity/activity.module';
import { CanonicalModule } from './modules/canonical/canonical.module';
import { ContextModule } from './modules/context/context.module';
import { HandoffModule } from './modules/handoff/handoff.module';
import { PortfolioModule } from './modules/portfolio/portfolio.module';
import { McpModule } from './modules/mcp/mcp.module';
import { ClientsModule } from './modules/clients/clients.module';
import { redisConnectionFromUrl } from './shared/redis-connection';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    EventEmitterModule.forRoot(),
    BullModule.forRoot({
      connection: redisConnectionFromUrl(process.env.REDIS_URL),
    }),
    PrismaModule,
    IdentityModule,
    SettingsModule,
    IngestionModule,
    InsightModule,
    BoardModule,
    CatalogModule,
    ActivityModule,
    CanonicalModule,
    ContextModule,
    HandoffModule,
    PortfolioModule,
    McpModule,
    // MVP3 / Frente Clientes (SPEC-029). Domínio disjunto do board de repos
    // (ADR-023): não fala com GitHub nem toca Project/Issue.
    ClientsModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
