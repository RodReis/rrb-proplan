import { Module } from '@nestjs/common';
import { CanonicalModule } from '../canonical/canonical.module';
import { BoardModule } from '../board/board.module';
import { HandoffModule } from '../handoff/handoff.module';
import { ContextModule } from '../context/context.module';
import { SettingsModule } from '../settings/settings.module';
import { McpToolsService } from './application/mcp-tools.service';

/**
 * Módulo MCP (SPEC-016, Fatia 11). Adaptador FINO de leitura sobre o julgamento
 * já persistido por 9/10/5/6/13.5 — consome por interface pública (ADR-001),
 * não reimplementa nada, não cria modelo Prisma novo. Exporta `McpToolsService`
 * para o entry stdio (`apps/mcp`) montar o McpServer. Zero IA (ADR-002).
 */
@Module({
  imports: [CanonicalModule, BoardModule, HandoffModule, ContextModule, SettingsModule],
  providers: [McpToolsService],
  exports: [McpToolsService],
})
export class McpModule {}
