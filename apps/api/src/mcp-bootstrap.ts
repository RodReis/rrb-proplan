/**
 * Barrel de bootstrap do MCP (SPEC-016, Fatia 11). O entry ESM isolado
 * (`apps/mcp`) importa TUDO daqui — `NestFactory`, `AppModule`, o token do
 * `McpToolsService` e o tipo do resultado — para que a resolução de `@nestjs/*`
 * aconteça pela árvore de dependências DA API, uma única instância. Importar
 * `@nestjs/core` direto no pacote `apps/mcp` carregaria uma SEGUNDA cópia e o DI
 * do `EventEmitterModule` quebra (duas instâncias de `@nestjs/core`). Este
 * arquivo é a fronteira que evita isso.
 */
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { McpToolsService } from './modules/mcp/application/mcp-tools.service';

export { NestFactory, AppModule, McpToolsService };
export type { ToolResult } from './modules/mcp/domain/evidence-contract';

/** Sobe o container Nest SEM servidor HTTP (só o DI para resolver os services)
 *  e devolve o adaptador das tools. */
export async function createMcpContext(): Promise<McpToolsService> {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });
  return app.get(McpToolsService);
}
