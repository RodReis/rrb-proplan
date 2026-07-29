import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { PrismaService } from '../../../prisma/prisma.service';
import type { MailJobData } from '../application/mail.service';
import { render } from '../domain/templates';
import { MAIL_QUEUE } from '../mail.constants';
import { MailProvider } from './resend.client';

/**
 * Quem realmente fala com o provedor (SPEC-038 §Escopo).
 *
 * **O corpo é renderizado aqui, e é o ponto do desenho.** O template e os dados
 * viajam no job; a `MailDelivery` guarda só o nome e o assunto. É o que permite
 * ter uma lista auditável de "o que foi enviado" sem que a chave em claro
 * exista em nenhuma linha do banco.
 *
 * **`attempts` é gravado a cada passagem, mesmo quando falha.** Sem isso, o
 * admin vê `FAILED` sem saber se o retry ainda vai acontecer — e "falhou uma
 * vez, o retry resolve" é decisão diferente de "falhou cinco vezes, alguém
 * precisa olhar".
 */
@Processor(MAIL_QUEUE)
export class MailWorker extends WorkerHost {
  private readonly logger = new Logger(MailWorker.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly provider: MailProvider,
  ) {
    super();
  }

  async process(job: Job<MailJobData>): Promise<void> {
    const { deliveryId, tenantId, template, data } = job.data;

    // Fora de request o RLS é fail-closed, e ler ou gravar sem contexto NÃO dá
    // erro — dá ZERO LINHAS. Um envio que "atualizou" zero linhas tem a mesma
    // cara de um bem-sucedido visto de fora. É a classe de bug que esta base já
    // pagou cinco vezes.
    await this.prisma.runInTenantContext([tenantId], async () => {
      const entrega = await this.prisma.mailDelivery.findUnique({
        where: { id: deliveryId },
      });

      if (!entrega) {
        // Sem linha não há o que atualizar nem como auditar. Não relança: o
        // retry procuraria a mesma linha inexistente mais quatro vezes.
        this.logger.warn(`Entrega ${deliveryId} não encontrada — job descartado`);
        return;
      }

      // Já enviada: a proteção contra reentrega. O BullMQ pode reprocessar um
      // job cujo worker morreu DEPOIS do envio e antes do commit — e um segundo
      // e-mail com a chave é pior que nenhum: o comprador não sabe qual vale.
      if (entrega.status === 'SENT') {
        this.logger.log(`Entrega ${deliveryId} já enviada — nada a fazer`);
        return;
      }

      // `attemptsMade` é 0 na primeira passagem: +1 conta a que está correndo.
      const tentativa = job.attemptsMade + 1;
      const { subject, html, text } = render(template, data as never);

      try {
        const { providerMessageId } = await this.provider.send({
          to: entrega.to,
          subject,
          html,
          text,
        });

        await this.prisma.mailDelivery.update({
          where: { id: deliveryId },
          data: {
            status: 'SENT',
            sentAt: new Date(),
            attempts: tentativa,
            providerMessageId,
            // Limpa o erro da tentativa anterior: uma entrega SENT que ainda
            // mostra a mensagem da falha de ontem faz o admin abrir chamado
            // para um problema que já se resolveu sozinho.
            error: null,
          },
        });
      } catch (erro) {
        const mensagem = erro instanceof Error ? erro.message : String(erro);

        await this.prisma.mailDelivery.update({
          where: { id: deliveryId },
          data: {
            // FAILED em toda passagem, inclusive nas que ainda vão retentar: o
            // estado do banco descreve o que aconteceu até agora, e `attempts`
            // diz se ainda há tentativa pela frente. O inverso (só marcar na
            // última) deixaria a falha invisível por minutos.
            status: 'FAILED',
            attempts: tentativa,
            error: mensagem.slice(0, 500),
          },
        });

        // Relança para o BullMQ contabilizar e reagendar com backoff. Engolir
        // aqui marcaria a entrega como falha definitiva na primeira instabilidade
        // de rede — que é justamente o que o retry existe para atravessar.
        throw erro;
      }
    });
  }
}
