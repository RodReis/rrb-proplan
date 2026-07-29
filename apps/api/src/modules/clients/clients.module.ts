import { Module } from '@nestjs/common';
import { IdentityModule } from '../identity/identity.module';
import { ClientsService } from './application/clients.service';
import { ClientsSummaryService } from './application/clients-summary.service';
import {
  ClientProjectsController,
  ClientsController,
} from './presentation/clients.controller';

/**
 * Frente Clientes (SPEC-029, Fatia 19) — 1º módulo do MVP3.
 *
 * Domínio disjunto do board de repos (ADR-023): não fala com GitHub, não toca
 * `Project`/`Issue`. Exporta o service para os módulos seguintes da frente
 * (briefing, artifacts) consumirem por interface pública, nunca por entidade
 * interna (ADR-001).
 *
 * Importa `IdentityModule` pelos guards de rota escopada (TenantGuard depende
 * do MembershipService).
 */
@Module({
  imports: [IdentityModule],
  controllers: [ClientsController, ClientProjectsController],
  providers: [ClientsService, ClientsSummaryService],
  // `ClientsSummaryService` é a superfície que o `dashboard` consome (SPEC-035
  // §2.1): os métodos do `ClientsService` são todos por PROJETO, e o dashboard
  // pergunta por TENANT. Exportar aqui é o que permite ao agregador compor sem
  // tocar `client_projects` direto (ADR-001).
  exports: [ClientsService, ClientsSummaryService],
})
export class ClientsModule {}
