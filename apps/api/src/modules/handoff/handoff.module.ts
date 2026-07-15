import { Module } from '@nestjs/common';
import { SharedModule } from '../../shared/shared.module';
import { IdentityModule } from '../identity/identity.module';
import { CanonicalModule } from '../canonical/canonical.module';
import { BoardModule } from '../board/board.module';
import { HandoffService } from './application/handoff.service';
import { HandoffCommitService } from './application/handoff-commit.service';
import { HandoffController } from './presentation/handoff.controller';

/**
 * Handoff exportável (SPEC-018, Fatia 13.5). Compõe o modelo canônico (Fatia 9)
 * e o board (Fatia 5) por interface pública (ADR-001) e serializa num pacote
 * portátil. Zero IA (ADR-002); write-back em `.proplan/HANDOFF.md` via o
 * write-back compartilhado (SharedModule, ADR-015). `assembleHandoff` é o
 * domínio que a Fatia 11 (MCP) herda (decisão 5 do PI).
 */
@Module({
  imports: [SharedModule, IdentityModule, CanonicalModule, BoardModule],
  controllers: [HandoffController],
  providers: [HandoffService, HandoffCommitService],
  exports: [HandoffService],
})
export class HandoffModule {}
