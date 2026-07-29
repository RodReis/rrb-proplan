import { Module } from '@nestjs/common';
import { IdentityModule } from '../identity/identity.module';
import { ActivityService } from './application/activity.service';
import { ActivitySummaryService } from './application/activity-summary.service';
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
  providers: [ActivityService, ActivitySummaryService],
  // `ActivitySummaryService` serve o dashboard (SPEC-035 §2.2): o `feed` do
  // painel é por projeto e exige o usuário dono; a retomada pergunta pelo
  // tenant inteiro. Duas perguntas, dois métodos.
  exports: [ActivityService, ActivitySummaryService],
})
export class ActivityModule {}
