import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ArtifactsModule } from '../artifacts/artifacts.module';
import { ClientsModule } from '../clients/clients.module';
import { IdentityModule } from '../identity/identity.module';
import { LlmModule } from '../llm';
import { EffortBreakdownService } from './application/effort-breakdown.service';
import { EstimateSettingsService } from './application/estimate-settings.service';
import { EstimatesService } from './application/estimates.service';
import { EstimatesSummaryService } from './application/estimates-summary.service';
import { ESTIMATES_QUEUE } from './estimates.constants';
import { EstimatesWorker } from './infrastructure/estimates.worker';
import { EstimatesController } from './presentation/estimates.controller';

/**
 * Estimativa — decomposição por IA + cálculo determinístico (SPEC-033).
 *
 * **Consome `artifacts` e `llm`; nunca o inverso** (§2). O `estimates` pede ao
 * `ArtifactsService` que persista a versão do `effort_breakdown` em vez de
 * escrever ele mesmo em `artifacts`/`artifact_versions`/`artifact_runs`: a regra
 * do ADR-001 é que módulo não toca entidade interna de outro, e `PrismaService`
 * ser global significa que nada barraria o import — a fronteira aqui é decisão,
 * não impedimento técnico.
 *
 * Fila própria (`estimates`), não a do `artifacts`: a decomposição é gatilho
 * **humano e sob demanda**, e um job dela na fila do pipeline automático
 * disputaria worker com a geração dos 4 artefatos, que é o caminho crítico do
 * briefing recém-enviado.
 */
@Module({
  imports: [
    ArtifactsModule,
    // Aprovar a estimativa move o card `ARTIFACTS_READY → CONTRACT_PENDING`
    // (§2.11). O `estimates` **pede** a transição pelo service público de
    // `clients` em vez de escrever em `client_projects`: a máquina de estados
    // vive no `domain/` daquele módulo (ADR-001). Mesmo caminho do `artifacts`.
    ClientsModule,
    LlmModule,
    IdentityModule,
    BullModule.registerQueue({ name: ESTIMATES_QUEUE }),
  ],
  controllers: [EstimatesController],
  providers: [
    EffortBreakdownService,
    EstimatesService,
    EstimateSettingsService,
    EstimatesWorker,
    EstimatesSummaryService,
  ],
  // `EstimatesSummaryService` serve o dashboard (SPEC-035 §2.3, item 2):
  // briefing sem estimativa ou estimativa sem aprovação, por tenant.
  exports: [EffortBreakdownService, EstimatesService, EstimatesSummaryService],
})
export class EstimatesModule {}
