import { Module } from '@nestjs/common';
import { IdentityModule } from '../identity/identity.module';
import { ContractIssueService } from './application/contract-issue.service';
import { ContractTemplateService } from './application/contract-template.service';
import { ProviderProfileService } from './application/provider-profile.service';
import { ContractsController } from './presentation/contracts.controller';

/**
 * Contratos (SPEC-034, Fatia 23) — perfil do prestador, templates versionados,
 * snapshot imutável e link público.
 *
 * PR-2 entrega perfil e templates; **PR-3, a emissão do snapshot**. O link
 * público (PR-4) e o aceite (PR-5) chegam depois, neste mesmo módulo.
 *
 * **Consome `estimates`, `artifacts` e `clients`; nunca o inverso.** A emissão
 * lê a `Estimate` aprovada e a `ArtifactVersion` de `kind = scope` — por ora em
 * leitura direta, que é o que a fronteira permite; **escrever** naquelas tabelas
 * é que passaria por cima do dono delas. O aceite pedirá a transição ao
 * `clients` (PR-5), porque a máquina de estados vive no `domain/` dele
 * (ADR-001). Como `PrismaService` é global, nada barraria a escrita direta: a
 * fronteira aqui é decisão, e o `contracts-boundaries.arch.spec.ts` a torna
 * verificável.
 */
@Module({
  imports: [IdentityModule],
  controllers: [ContractsController],
  providers: [ProviderProfileService, ContractTemplateService, ContractIssueService],
  exports: [ProviderProfileService, ContractTemplateService, ContractIssueService],
})
export class ContractsModule {}
