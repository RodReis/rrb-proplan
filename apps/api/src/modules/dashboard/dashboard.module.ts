import { Module } from '@nestjs/common';
import { ActivityModule } from '../activity/activity.module';
import { ArtifactsModule } from '../artifacts/artifacts.module';
import { ClientsModule } from '../clients/clients.module';
import { ContractsModule } from '../contracts/contracts.module';
import { EstimatesModule } from '../estimates/estimates.module';
import { IdentityModule } from '../identity/identity.module';
import { BoardModule } from '../board/board.module';
import { DashboardReposService } from './application/dashboard-repos.service';
import { DashboardSettingsService } from './application/dashboard-settings.service';
import { DashboardService } from './application/dashboard.service';
import { DashboardController } from './presentation/dashboard.controller';

/**
 * Dashboard — retomada, funil de clientes e Kanban de repos (SPEC-035).
 *
 * **Não é módulo de dados.** Nenhuma tabela, nenhuma entidade, nada gravado
 * (§2, §3) — a única escrita do módulo é na própria configuração dele
 * (`stalled_days` em `tenant_settings`). Os números da tela são derivados a cada
 * leitura, sem cache e sem tabela de notificação (§7.4): derivar sempre é mais
 * lento e nunca mente.
 *
 * **Consome os cinco módulos; nenhum deles o consome.** Cada import aqui existe
 * por um bloco da tela, e o `DashboardService` não recebe `PrismaService` — sem
 * o cliente injetado, não há como consultar tabela de outro módulo nem por
 * acidente. O `dashboard.arch.spec.ts` prova por varredura, porque o
 * `PrismaService` é global e o `exports` do Nest resolve **injeção**, não o
 * import de TypeScript (ADR-027).
 */
@Module({
  imports: [
    // Funil, cards parados e a trilha de transições.
    ClientsModule,
    // Artefatos em `PENDING_REVIEW` — 1º item de *Esperando você*.
    ArtifactsModule,
    // Briefing sem estimativa / estimativa sem aprovação — 2º item.
    EstimatesModule,
    // Contratos sem aceite — 3º item — e a contagem do período.
    ContractsModule,
    // As outras duas trilhas de "O que andou por aqui": auditoria e sync.
    ActivityModule,
    // O bloco de repos ao vivo (§2.6). É o único import que traz uma dependência
    // de TERCEIRO para o caminho de abertura da tela — daí a rota isolada e as 4
    // salvaguardas do §2.11.
    BoardModule,
    IdentityModule,
  ],
  controllers: [DashboardController],
  providers: [DashboardService, DashboardSettingsService, DashboardReposService],
})
export class DashboardModule {}
