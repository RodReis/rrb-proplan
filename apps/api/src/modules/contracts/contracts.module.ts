import { Module } from '@nestjs/common';
import { IdentityModule } from '../identity/identity.module';
import { ContractTemplateService } from './application/contract-template.service';
import { ProviderProfileService } from './application/provider-profile.service';
import { ContractsController } from './presentation/contracts.controller';

/**
 * Contratos (SPEC-034, Fatia 23) — perfil do prestador, templates versionados,
 * snapshot imutável e link público.
 *
 * PR-2 entrega perfil e templates. A emissão do snapshot (PR-3), o link público
 * (PR-4) e o aceite (PR-5) chegam depois, neste mesmo módulo.
 *
 * **Consumirá `estimates`, `artifacts` e `clients`; nunca o inverso.** A
 * emissão lê a `Estimate` aprovada e a `ArtifactVersion` de `kind = scope`
 * pelos services públicos daqueles módulos, e o aceite pede a transição ao
 * `clients` — a máquina de estados vive no `domain/` dele (ADR-001). Como
 * `PrismaService` é global, nada barraria o import direto: a fronteira aqui é
 * decisão, e o arch-spec do PR-3 a torna verificável.
 */
@Module({
  imports: [IdentityModule],
  controllers: [ContractsController],
  providers: [ProviderProfileService, ContractTemplateService],
  exports: [ProviderProfileService, ContractTemplateService],
})
export class ContractsModule {}
