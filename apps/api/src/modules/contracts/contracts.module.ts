import { Module } from '@nestjs/common';
import { IdentityModule } from '../identity/identity.module';
import { ContractIssueService } from './application/contract-issue.service';
import { ContractLinkService } from './application/contract-link.service';
import { ContractTemplateService } from './application/contract-template.service';
import { ProviderProfileService } from './application/provider-profile.service';
import { ContractPublicController } from './presentation/contract-public.controller';
import { ContractsController } from './presentation/contracts.controller';

/**
 * Contratos (SPEC-034, Fatia 23) — perfil do prestador, templates versionados,
 * snapshot imutável e link público.
 *
 * PR-2 entrega perfil e templates; PR-3, a emissão do snapshot; **PR-4, o link
 * público**. O aceite (PR-5) chega depois, neste mesmo módulo.
 *
 * **Dois controllers, e a separação é a decisão.** O `ContractsController` é
 * todo autenticado, sob `JwtAuthGuard` + `TenantGuard` + contexto de tenant. O
 * `ContractPublicController` (`/c/:token`) não tem guard nenhum — quem o abre é
 * o cliente do prestador, que não tem conta. Separar em arquivos distintos é o
 * que impede uma rota pública de nascer por engano dentro do controller
 * protegido, herdando um `@UseGuards` que ela não deveria ter (ou pior: sendo
 * adicionada ao público sem ninguém notar que ali não há sessão).
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
  controllers: [ContractsController, ContractPublicController],
  providers: [
    ProviderProfileService,
    ContractTemplateService,
    ContractIssueService,
    ContractLinkService,
  ],
  exports: [
    ProviderProfileService,
    ContractTemplateService,
    ContractIssueService,
    ContractLinkService,
  ],
})
export class ContractsModule {}
