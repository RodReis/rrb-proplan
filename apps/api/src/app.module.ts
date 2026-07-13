import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { PrismaModule } from './prisma/prisma.module';
import { IdentityModule } from './modules/identity/identity.module';
import { CatalogModule } from './modules/catalog/catalog.module';
import { IngestionModule } from './modules/ingestion/ingestion.module';
import { InsightModule } from './modules/insight/insight.module';
import { BoardModule } from './modules/board/board.module';
import { SettingsModule } from './modules/settings/settings.module';

const redisUrl = new URL(process.env.REDIS_URL ?? 'redis://localhost:6379');

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    EventEmitterModule.forRoot(),
    BullModule.forRoot({
      connection: {
        host: redisUrl.hostname,
        port: Number(redisUrl.port) || 6379,
      },
    }),
    PrismaModule,
    IdentityModule,
    SettingsModule,
    IngestionModule,
    InsightModule,
    BoardModule,
    CatalogModule,
  ],
})
export class AppModule {}
