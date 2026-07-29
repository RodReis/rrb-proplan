import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { HealthController } from './health.controller';
import { PrismaModule } from './prisma/prisma.module';
import { IdentityModule } from './modules/identity/identity.module';
import { CatalogModule } from './modules/catalog/catalog.module';
import { IngestionModule } from './modules/ingestion/ingestion.module';
import { InsightModule } from './modules/insight/insight.module';
import { LlmModule } from './modules/llm';
import { BoardModule } from './modules/board/board.module';
import { SettingsModule } from './modules/settings/settings.module';
import { ActivityModule } from './modules/activity/activity.module';
import { CanonicalModule } from './modules/canonical/canonical.module';
import { ContextModule } from './modules/context/context.module';
import { HandoffModule } from './modules/handoff/handoff.module';
import { PortfolioModule } from './modules/portfolio/portfolio.module';
import { McpModule } from './modules/mcp/mcp.module';
import { ClientsModule } from './modules/clients/clients.module';
import { ArtifactsModule } from './modules/artifacts/artifacts.module';
import { ContractsModule } from './modules/contracts/contracts.module';
import { LicensingModule } from './modules/licensing/licensing.module';
import { DashboardModule } from './modules/dashboard/dashboard.module';
import { EstimatesModule } from './modules/estimates/estimates.module';
import { BriefingModule } from './modules/briefing/briefing.module';
import { redisConnectionFromUrl } from './shared/redis-connection';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    EventEmitterModule.forRoot(),
    BullModule.forRoot({
      connection: redisConnectionFromUrl(process.env.REDIS_URL),
    }),
    PrismaModule,
    IdentityModule,
    SettingsModule,
    IngestionModule,
    // Acesso a LLM: porta, adapters, ledger e gate do teto (SPEC-032 §7.2).
    // Registrado aqui, e não só via InsightModule, porque a rota /usage/llm e o
    // gate não podem depender de o insight existir — o `artifacts` (Fatia 21) é
    // o próximo cliente.
    LlmModule,
    InsightModule,
    BoardModule,
    CatalogModule,
    ActivityModule,
    CanonicalModule,
    ContextModule,
    HandoffModule,
    PortfolioModule,
    McpModule,
    // MVP3 / Frente Clientes (SPEC-029). Domínio disjunto do board de repos
    // (ADR-023): não fala com GitHub nem toca Project/Issue.
    ClientsModule,
    // Ciclo de vida do link de briefing (SPEC-029). Expõe a única rota PÚBLICA
    // da frente (`/b/:token`), fora dos guards de tenant por design.
    BriefingModule,
    // Pipeline de IA sobre o briefing enviado (SPEC-032). Registrado aqui, e
    // não via BriefingModule, porque o acoplamento entre os dois é o EVENTO
    // `BriefingSubmitted` — o briefing não sabe (nem deve saber) que alguém o
    // escuta.
    ArtifactsModule,
    // Estimativa sobre os requisitos aprovados (SPEC-033). Consome `artifacts`
    // e `llm`, nunca o inverso (§2). Fila própria: a decomposição é gatilho
    // humano sob demanda e não pode disputar worker com o pipeline automático
    // do briefing recém-enviado.
    EstimatesModule,
    // Contratos sobre a estimativa aprovada (SPEC-034). Expõe a 2ª rota PÚBLICA
    // da frente (`/c/:token`, PR-4) — e, como a do briefing, fora dos guards de
    // tenant por design: o tenant vem do hash do token (ADR-020).
    ContractsModule,
    // Dashboard (SPEC-035) — última do MVP3. Só compõe: lê os cinco módulos
    // acima por service público e não tem tabela nem `PrismaService` próprio
    // para os números da tela. Entra por último de propósito: consome todos os
    // outros e nenhum o consome.
    DashboardModule,
    // Licenciamento (SPEC-036) — 1ª do MVP4, frente DISJUNTA das outras duas:
    // não lê cliente, contrato nem card de funil. Expõe a 3ª rota PÚBLICA do
    // produto (`/licensing/v1/activate`, PR-3), fora dos guards pelo mesmo
    // motivo das outras: quem chama é o binário na máquina do comprador, e o
    // tenant vem do hash da chave (ADR-020).
    LicensingModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
