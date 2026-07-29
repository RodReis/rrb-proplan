import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ClientsModule } from '../clients/clients.module';
import { IdentityModule } from '../identity/identity.module';
import { LlmModule } from '../llm';
import { ArtifactReadService } from './application/artifact-read.service';
import { ArtifactsSummaryService } from './application/artifacts-summary.service';
import { ArtifactReviewService } from './application/artifact-review.service';
import { ArtifactsService } from './application/artifacts.service';
import { ARTIFACTS_QUEUE } from './artifacts.constants';
import {
  ArtifactsEventListener,
  ArtifactsWorker,
} from './infrastructure/artifacts.worker';
import { ArtifactsController } from './presentation/artifacts.controller';

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
 * verificado antes de enfileirar e antes de cada capacidade.
 *
 * `ClientsModule` entra porque aprovar os 4 artefatos move o card no funil. O
 * `artifacts` **pede** a transição pelo service público de `clients` em vez de
 * escrever em `client_projects`: a máquina de estados vive no `domain/` daquele
 * módulo, e módulo não toca entidade interna de outro (ADR-001). É o mesmo
 * caminho que o `briefing` usa.
 */
@Module({
  imports: [
    LlmModule,
    ClientsModule,
    IdentityModule,
    BullModule.registerQueue({ name: ARTIFACTS_QUEUE }),
  ],
  controllers: [ArtifactsController],
  providers: [
    ArtifactsService,
    ArtifactReviewService,
    ArtifactReadService,
    ArtifactsEventListener,
    ArtifactsWorker,
    ArtifactsSummaryService,
  ],
  // `ArtifactsSummaryService` serve o dashboard (SPEC-035 §6): o
  // `ArtifactReadService` responde "como está o projeto X"; a tela pergunta "o
  // que no tenant inteiro espera revisão".
  exports: [ArtifactsService, ArtifactReadService, ArtifactsSummaryService],
})
export class ArtifactsModule {}
