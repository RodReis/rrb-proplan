import { Module } from '@nestjs/common';
import { IdentityModule } from '../identity/identity.module';
import { BriefingLinkService } from './application/briefing-link.service';
import { BriefingLinkController } from './presentation/briefing-link.controller';
import { BriefingPublicController } from './presentation/briefing-public.controller';

/**
 * Briefing (SPEC-029, Fatia 19) — nesta fatia, **só o ciclo de vida do link**.
 * O formulário público de 9 etapas é a fatia seguinte.
 *
 * Dois controllers de propósito: um autenticado sob `/t/:tenant` (o prestador
 * gerindo o link) e um **público** em `/b/:token` (o cliente abrindo). A
 * separação é o que mantém a rota pública fora dos guards de tenant — ela não
 * pode depender de sessão, e o tenant dela vem do hash do token.
 */
@Module({
  imports: [IdentityModule],
  controllers: [BriefingLinkController, BriefingPublicController],
  providers: [BriefingLinkService],
  exports: [BriefingLinkService],
})
export class BriefingModule {}
