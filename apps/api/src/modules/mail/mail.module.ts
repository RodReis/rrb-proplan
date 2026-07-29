import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { MailService } from './application/mail.service';
import { MailWorker } from './infrastructure/mail.worker';
import { MailProvider, ResendClient } from './infrastructure/resend.client';
import { MAIL_QUEUE } from './mail.constants';

/**
 * Envio transacional (SPEC-038 §Escopo → Módulo `mail`).
 *
 * **Compartilhado, não do `licensing`.** Ele nasce nesta fatia porque a venda
 * precisa dele, mas a interface é `send({ to, template, data })` — nada de
 * licença aparece na assinatura. O MVP3 vai mandar e-mail de briefing pelo
 * mesmo caminho, e quando isso acontecer não haverá o que refatorar.
 *
 * **Sem controller.** A superfície é o `MailService`, consumido por outros
 * módulos; a lista de entregas do admin é servida pelo controller do
 * `licensing` (§Admin), que é quem tem o guard de tenant e a tela. Um
 * controller aqui exigiria decidir a rota de um módulo que não tem dono de UI.
 *
 * **`MailProvider` é o token, `ResendClient` é a implementação.** É o que faz o
 * worker depender da fronteira e não do Resend — e o que permite ao teste
 * injetar um provedor que falha, sem rede.
 */
@Module({
  imports: [BullModule.registerQueue({ name: MAIL_QUEUE })],
  providers: [
    MailService,
    MailWorker,
    { provide: MailProvider, useClass: ResendClient },
  ],
  exports: [MailService],
})
export class MailModule {}
