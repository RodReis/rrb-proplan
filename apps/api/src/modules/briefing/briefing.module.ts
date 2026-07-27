import { Module } from '@nestjs/common';
import { ClientsModule } from '../clients/clients.module';
import { IdentityModule } from '../identity/identity.module';
import { BriefingAttachmentService } from './application/briefing-attachment.service';
import { BriefingDraftService } from './application/briefing-draft.service';
import { BriefingLinkService } from './application/briefing-link.service';
import { BriefingReadService } from './application/briefing-read.service';
import { BriefingReferenceService } from './application/briefing-reference.service';
import { BriefingSubmitService } from './application/briefing-submit.service';
import { BriefingAttachmentController } from './presentation/briefing-attachment.controller';
import { BriefingLinkController } from './presentation/briefing-link.controller';
import { BriefingPublicController } from './presentation/briefing-public.controller';
import { BriefingReadController } from './presentation/briefing-read.controller';
import { FileAssetController } from './presentation/file-asset.controller';

/**
 * Briefing (SPEC-029 + SPEC-031) — ciclo de vida do link e rascunho retomável.
 *
 * Dois controllers de propósito: um autenticado sob `/t/:tenant` (o prestador
 * gerindo o link) e um **público** em `/b/:token` (o cliente abrindo). A
 * separação é o que mantém a rota pública fora dos guards de tenant — ela não
 * pode depender de sessão, e o tenant dela vem do hash do token.
 *
 * `ClientsModule` entra porque o 1º save do rascunho move o card no funil. O
 * briefing **pede** a transição pelo service público de `clients` em vez de
 * escrever em `client_projects`: a máquina de estados vive no `domain/` daquele
 * módulo, e módulo não toca entidade interna de outro (ADR-001).
 */
@Module({
  imports: [IdentityModule, ClientsModule],
  controllers: [
    BriefingLinkController,
    BriefingPublicController,
    BriefingAttachmentController,
    FileAssetController,
    BriefingReadController,
  ],
  providers: [
    BriefingLinkService,
    BriefingDraftService,
    BriefingReferenceService,
    BriefingAttachmentService,
    BriefingSubmitService,
    BriefingReadService,
  ],
  exports: [
    BriefingLinkService,
    BriefingDraftService,
    BriefingAttachmentService,
    BriefingSubmitService,
  ],
})
export class BriefingModule {}
