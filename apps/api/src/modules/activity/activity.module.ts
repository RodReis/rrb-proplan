import { Module } from '@nestjs/common';
import { IdentityModule } from '../identity/identity.module';
import { ActivityService } from './application/activity.service';
import { ActivityController } from './presentation/activity.controller';
import { ActivityFeedController } from './presentation/activity-feed.controller';

/**
 * Módulo `activity` (SPEC-010, Fatia 7.6): dono do modelo Operation e da
 * composição do histórico (Fase 4). Exporta ActivityService para os 4 fluxos
 * de escrita (board, insight) criarem e avançarem operações pela interface
 * pública — nunca importando entidade interna (CLAUDE.md).
 */
@Module({
  imports: [IdentityModule],
  controllers: [ActivityController, ActivityFeedController],
  providers: [ActivityService],
  exports: [ActivityService],
})
export class ActivityModule {}
