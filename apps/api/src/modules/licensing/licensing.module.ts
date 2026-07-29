import { Module } from '@nestjs/common';
import { IdentityModule } from '../identity/identity.module';
import { LicCatalogService } from './application/lic-catalog.service';
import { LicenseActivationService } from './application/license-activation.service';
import { LicenseAdminService } from './application/license-admin.service';
import { LicenseSigningService } from './application/license-signing.service';
import { LicensingAdminController } from './presentation/licensing-admin.controller';
import { LicensingPublicController } from './presentation/licensing-public.controller';

/**
 * Licenciamento (SPEC-036, Fatia 25 — 1ª do MVP4). Piloto: War Room.
 *
 * PR-1 entregou o schema; PR-2, o domínio e o admin; **PR-3, a rota pública
 * `/activate`**; PR-4, a tela.
 *
 * **`IdentityModule` é o único import — e isso não é acidente.** Licenciamento
 * é uma frente disjunta das outras duas (ADR-023/024 valem aqui pelo mesmo
 * princípio): não lê `Client`, não lê `Contract`, não move card de funil. A
 * costura com o catálogo existe como `LicProduct.projectId?` opcional (MVP4
 * §4), que é uma coluna — não uma dependência de módulo. Se um compositor
 * quiser métricas daqui, o módulo exporta um `licensing-summary.service.ts`
 * (MVP4 §3); ele não recebe `PrismaService`.
 *
 * **Dois controllers, e a separação é a decisão.** O `LicensingAdminController`
 * é todo autenticado, sob `JwtAuthGuard` + `TenantGuard` + contexto de tenant.
 * O `LicensingPublicController` (`/licensing/v1`) não tem guard nenhum — quem o
 * chama é o binário na máquina do comprador, que não tem conta no ProPlan.
 * Arquivos distintos é o que impede uma rota pública de nascer por engano
 * dentro do controller protegido, herdando um `@UseGuards` que ela não deveria
 * ter — ou, pior, de ser adicionada ao público sem ninguém notar que ali não há
 * sessão.
 *
 * **`LicenseSigningService` é o único ponto que toca a chave privada.**
 * Concentrar ali é o que torna verificável a afirmação de que ela não sai do
 * servidor; o arch-spec do PR-4 varre justamente isso.
 */
@Module({
  imports: [IdentityModule],
  controllers: [LicensingAdminController, LicensingPublicController],
  providers: [
    LicCatalogService,
    LicenseAdminService,
    LicenseActivationService,
    LicenseSigningService,
  ],
  exports: [LicenseAdminService, LicenseSigningService],
})
export class LicensingModule {}
