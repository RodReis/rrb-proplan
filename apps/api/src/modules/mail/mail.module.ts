import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { MailService } from './application/mail.service';
import { MailWorker } from './infrastructure/mail.worker';
import { MailProvider, ResendClient } from './infrastructure/resend.client';
import { SmtpClient } from './infrastructure/smtp.client';
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
 * **`MailProvider` é o token, o cliente concreto é a implementação.** É o que faz
 * o worker depender da fronteira e não do provedor — e o que permite ao teste
 * injetar um provedor que falha, sem rede. Esta fatia é a primeira a cobrar essa
 * promessa: a troca abaixo é uma linha, e nenhum chamador mudou.
 *
 * **`MAIL_PROVIDER` escolhe, e o padrão é SMTP.** A decisão PI #4 da SPEC-038
 * escolheu o Resend; o pressuposto caiu na operação (plano gratuito verifica um
 * domínio, o da conta já está em uso, e acrescentar outro custa US$20/mês), e o
 * PI decidiu em 2026-08-04 usar a caixa SMTP já paga. O `ResendClient` **fica**:
 * ele está testado, o custo de mantê-lo é zero, e voltar atrás vira variável de
 * ambiente em vez de novo PR — que é exatamente o que a fronteira prometia.
 */
function escolherProvider() {
  return (process.env.MAIL_PROVIDER ?? 'smtp').toLowerCase() === 'resend'
    ? ResendClient
    : SmtpClient;
}

@Module({
  imports: [BullModule.registerQueue({ name: MAIL_QUEUE })],
  providers: [
    MailService,
    MailWorker,
    ResendClient,
    SmtpClient,
    { provide: MailProvider, useClass: escolherProvider() },
  ],
  exports: [MailService],
})
export class MailModule {}
