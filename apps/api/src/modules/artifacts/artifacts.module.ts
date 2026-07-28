import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { LlmModule } from '../llm';
import { ArtifactsService } from './application/artifacts.service';
import { ARTIFACTS_QUEUE } from './artifacts.constants';
import {
  ArtifactsEventListener,
  ArtifactsWorker,
} from './infrastructure/artifacts.worker';

/**
 * Pipeline de IA — artefatos versionados com aprovação humana (SPEC-032).
 *
 * **Não importa o `BriefingModule`**, e isso é deliberado: o acoplamento com o
 * briefing é o *evento* `BriefingSubmitted`, entregue pelo `EventEmitter2`. O
 * que atravessa a fronteira é o **tipo** do payload, não um provider — então
 * não há injeção a declarar, e o briefing continua sem saber que alguém o
 * escuta (que é o ponto de ter emitido o evento na SPEC-031 sem consumidor).
 *
 * `LlmModule` entra pela superfície pública (ADR-027): o gate do teto é
 * verificado antes de enfileirar e, no PR-3, antes de cada capacidade.
 */
@Module({
  imports: [LlmModule, BullModule.registerQueue({ name: ARTIFACTS_QUEUE })],
  providers: [ArtifactsService, ArtifactsEventListener, ArtifactsWorker],
  exports: [ArtifactsService],
})
export class ArtifactsModule {}
