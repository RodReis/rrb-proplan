import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ArtifactsModule } from '../artifacts/artifacts.module';
import { IdentityModule } from '../identity/identity.module';
import { LlmModule } from '../llm';
import { EffortBreakdownService } from './application/effort-breakdown.service';
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
    LlmModule,
    IdentityModule,
    BullModule.registerQueue({ name: ESTIMATES_QUEUE }),
  ],
  controllers: [EstimatesController],
  providers: [EffortBreakdownService, EstimatesWorker],
  exports: [EffortBreakdownService],
})
export class EstimatesModule {}
