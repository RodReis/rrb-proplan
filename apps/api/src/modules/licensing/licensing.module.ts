import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { IdentityModule } from '../identity/identity.module';
import { MailModule } from '../mail/mail.module';
import { LicCatalogService } from './application/lic-catalog.service';
import { LicenseActivationService } from './application/license-activation.service';
import { LicenseAdminService } from './application/license-admin.service';
import { LicenseExpirySweepService } from './application/license-expiry-sweep.service';
import { LicenseSigningService } from './application/license-signing.service';
import { LicensingOpsService } from './application/licensing-ops.service';
import { SourceInviteService } from './application/source-invite.service';
import { SourceLinkService } from './application/source-link.service';
import { SourceAdminService } from './application/source-admin.service';
import { SourceRevokeService } from './application/source-revoke.service';
import { WebhookIntakeService } from './application/webhook-intake.service';
import { WebhookProcessorService } from './application/webhook-processor.service';
import { GithubSourceClient } from './infrastructure/github-source.client';
import { LicensingWorker } from './infrastructure/licensing.worker';
import { LICENSING_QUEUE } from './licensing.constants';
import { LicensingAdminController } from './presentation/licensing-admin.controller';
import { LicensingPublicController } from './presentation/licensing-public.controller';
import { SourceLinkPublicController } from './presentation/source-link-public.controller';

/**
 * Licenciamento (SPEC-036, Fatia 25 — 1ª do MVP4). Piloto: War Room.
 *
 * PR-1 entregou o schema; PR-2, o domínio e o admin; **PR-3, a rota pública
 * `/activate`**; PR-4, a tela.
 *
 * A SPEC-038 (Fatia 27) continua aqui: PR-1 o schema do webhook, PR-2 o módulo
 * `mail`, PR-3 o webhook da Kiwify, **PR-4 o ciclo da assinatura** — o corte por
 * inadimplência na validação e o job que materializa `EXPIRED`.
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
  imports: [
    IdentityModule,
    // **A única exceção à regra do bloco acima, e ela é o desenho da SPEC-038.**
    // O `mail` não é uma frente: é infraestrutura compartilhada, com assinatura
    // que não menciona licença (`send({ to, template, data })`). O `licensing`
    // o consome pelo **service público**, exatamente como o arch-spec de lá
    // exige — nunca escrevendo em `mail_deliveries`, que pularia a fila.
    MailModule,
    BullModule.registerQueue({ name: LICENSING_QUEUE }),
  ],
  controllers: [
    LicensingAdminController,
    LicensingPublicController,
    // **Terceiro controller, e o terceiro arquivo é o mesmo argumento do
    // segundo.** A coleta de username também é pública, mas fora do
    // `/licensing/v1`: aquele prefixo é contrato estável consumido pelo binário
    // do War Room noutro repo, e esta rota é da nossa página React — vai mudar
    // quando a tela mudar. Pendurá-la lá prometeria estabilidade que ela não tem.
    SourceLinkPublicController,
  ],
  providers: [
    LicCatalogService,
    LicenseAdminService,
    LicenseActivationService,
    LicenseExpirySweepService,
    LicenseSigningService,
    LicensingOpsService,
    SourceLinkService,
    // A reconciliação do convite (SPEC-039 PR-3). Sem agendador de propósito:
    // não há `@nestjs/schedule` nem `repeat` no repo e a spec não diz como
    // dispara — escolher isso é decisão de infra. O método é chamável, e o
    // PR-5 dá o botão ao admin.
    SourceInviteService,
    // A revogação do acesso ao repo (SPEC-039 PR-4). Existe separado do
    // `SourceInviteService` porque a decisão que ele carrega é outra: **qual das
    // duas chamadas do GitHub desfaz o acesso** — cancelar a invitation pelo id,
    // ou remover o colaborador pelo username. Chamar a errada é no-op silencioso,
    // e o reembolsado fica com o código-fonte.
    SourceRevokeService,
    // O admin do acesso ao source (SPEC-039 PR-5): pendências, correção de
    // username, reemissão, revogação manual e o PAT write-only com teste de
    // conexão. Fecha a fatia — sem ele, os três estados que pedem gente
    // (`PENDING` sem username, `INVITED` parado, `FAILED`) são informação no
    // banco que ninguém alcança.
    SourceAdminService,
    // O cliente do GitHub do caminho do convite — **não** o do GitHub App
    // (ADR-015). Credenciais de propósitos diferentes: aqui é PAT fine-grained
    // com `administration:write` num repo só, e a arch-spec cobra a separação.
    GithubSourceClient,
    WebhookIntakeService,
    WebhookProcessorService,
    LicensingWorker,
  ],
  exports: [LicenseAdminService, LicenseSigningService],
})
export class LicensingModule {}
