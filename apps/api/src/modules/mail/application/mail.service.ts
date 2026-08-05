import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Queue } from 'bullmq';
import { PrismaService } from '../../../prisma/prisma.service';
import { MAIL_QUEUE } from '../mail.constants';
import { render, type TemplateName } from '../domain/templates';

/**
 * A superfície pública do módulo `mail` (SPEC-038 §Escopo).
 *
 * ## Enfileira, não envia
 *
 * `send()` grava a `MailDelivery` como `PENDING` e devolve. Quem fala com o
 * provedor é o worker.
 *
 * O motivo é a garantia da fatia: **falha de envio nunca desfaz o que já foi
 * gravado**. Se o `licensing` esperasse o Resend responder para concluir a
 * emissão, um provedor fora do ar transformaria uma compra paga numa licença
 * não emitida — e a plataforma não reenvia o evento de compra por conta de um
 * erro nosso. Emitir e enfileirar são coisas diferentes; só a primeira é
 * inegociável.
 *
 * ## O corpo não é persistido
 *
 * O template é renderizado no **worker**, a partir do nome e dos dados do job.
 * A `MailDelivery` guarda `template` e `subject`, nunca o `html`. Guardar o
 * corpo do `license_key` seria guardar a chave em claro por outro nome, e
 * desfaria a garantia central da SPEC-036 — que é justamente por que reenviar
 * não reenvia a chave.
 */

export interface SendInput {
  tenantId: string;
  to: string;
  template: TemplateName;
  /** Variáveis do template. Viajam no job; nada aqui é persistido. */
  data: Record<string, unknown>;
  /** Licença que originou o envio, quando há uma. */
  licenseId?: string;
}

/** Um envio, como o admin o vê. */
export interface MailDeliveryView {
  id: string;
  to: string;
  template: string;
  subject: string;
  status: string;
  attempts: number;
  error: string | null;
  providerMessageId: string | null;
  licenseId: string | null;
  createdAt: string;
  sentAt: string | null;
}

/** O que o worker recebe. Os dados do template viajam aqui, não no banco. */
export interface MailJobData {
  deliveryId: string;
  tenantId: string;
  template: TemplateName;
  data: Record<string, unknown>;
}

/**
 * 5 tentativas com backoff exponencial a partir de 10 s (10s · 20s · 40s ·
 * 80s). Mais que os 2–3 do resto da casa de propósito: os outros jobs releem
 * uma fonte que continua lá, enquanto um e-mail perdido não tem segunda via —
 * a chave que ele carrega não existe mais em lugar nenhum.
 */
const TENTATIVAS = 5;
const BACKOFF_MS = 10_000;

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);

  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue(MAIL_QUEUE) private readonly fila: Queue<MailJobData>,
  ) {}

  /**
   * Registra o envio e enfileira. Devolve o id da `MailDelivery`.
   *
   * **Grava antes de enfileirar, e a ordem é a decisão.** Se o Redis estiver
   * fora, a linha `PENDING` fica no banco e aparece na lista do admin como
   * pendência real. Na ordem inversa, um job enfileirado sem linha no banco
   * seria um envio que ninguém consegue auditar — e o worker falharia ao
   * procurar a `MailDelivery` que nunca existiu.
   */
  async send(input: SendInput): Promise<string> {
    // Renderiza aqui só para extrair o `subject` — o corpo é descartado e
    // reconstruído no worker. É o que permite listar "o que foi enviado" sem
    // guardar o que foi enviado.
    const { subject } = render(input.template, input.data as never);

    const entrega = await this.prisma.mailDelivery.create({
      data: {
        tenantId: input.tenantId,
        to: input.to,
        template: input.template,
        subject,
        licenseId: input.licenseId ?? null,
      },
      select: { id: true },
    });

    await this.fila.add(
      'send',
      {
        deliveryId: entrega.id,
        tenantId: input.tenantId,
        template: input.template,
        data: input.data,
      },
      {
        attempts: TENTATIVAS,
        backoff: { type: 'exponential', delay: BACKOFF_MS },
        removeOnComplete: 200,
        // Falha fica na fila para ser vista: `MailDelivery` conta a história no
        // banco, mas o job com o stack é o que diz onde quebrou.
        removeOnFail: 500,
      },
    );

    this.logger.log(`E-mail ${input.template} enfileirado (entrega ${entrega.id})`);
    return entrega.id;
  }

  /**
   * Reenfileira uma entrega que falhou (§Admin).
   *
   * **Precisa dos dados do template de novo** — eles nunca foram persistidos.
   * Quem chama é o admin do `licensing`, que sabe remontar o contexto a partir
   * da licença. Para o `license_key` isso é impossível por construção (a chave
   * não existe mais), e é por isso que a reemissão daquela fatia é um ato
   * distinto, com revogação da anterior.
   */
  async retry(
    tenantId: string,
    deliveryId: string,
    data: Record<string, unknown>,
  ): Promise<void> {
    const entrega = await this.prisma.mailDelivery.findFirst({
      where: { id: deliveryId, tenantId },
    });
    if (!entrega) throw new NotFoundException('Entrega não encontrada');

    // Volta para PENDING: sem isto, uma entrega reenfileirada continuaria
    // FAILED na lista até o worker pegá-la, e o admin clicaria de novo achando
    // que o primeiro clique não pegou.
    await this.prisma.mailDelivery.update({
      where: { id: deliveryId },
      data: { status: 'PENDING', error: null },
    });

    await this.fila.add(
      'send',
      {
        deliveryId,
        tenantId,
        template: entrega.template as TemplateName,
        data,
      },
      {
        attempts: TENTATIVAS,
        backoff: { type: 'exponential', delay: BACKOFF_MS },
        removeOnComplete: 200,
        removeOnFail: 500,
      },
    );

    this.logger.log(`Entrega ${deliveryId} reenfileirada pelo admin`);
  }

  /**
   * Uma entrega do tenant, ou `null` (§Admin).
   *
   * Existe separado do `list` porque aquele trunca em 200: procurar ali a
   * entrega que se quer reenfileirar acharia só as recentes, e uma falha antiga
   * responderia "não encontrada" — o mesmo beco que o FIX #254 veio fechar.
   *
   * `tenantId` no `where` além do RLS, como no `retry`: mesma resposta para
   * "não existe" e "é de outro tenant".
   */
  async find(tenantId: string, deliveryId: string): Promise<MailDeliveryView | null> {
    const e = await this.prisma.mailDelivery.findFirst({
      where: { id: deliveryId, tenantId },
    });
    return e ? paraView(e) : null;
  }

  /** Entregas do tenant, mais recentes primeiro (§Admin). */
  async list(tenantId: string, status?: string): Promise<MailDeliveryView[]> {
    const filtro = ['PENDING', 'SENT', 'FAILED'].includes(status ?? '')
      ? (status as 'PENDING' | 'SENT' | 'FAILED')
      : undefined;

    const entregas = await this.prisma.mailDelivery.findMany({
      where: { tenantId, ...(filtro ? { status: filtro } : {}) },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });

    return entregas.map(paraView);
  }
}

/**
 * Linha do banco → o que o admin vê. Um lugar só porque `find` e `list`
 * devolvem o mesmo contrato, e duas cópias divergiriam no dia em que uma coluna
 * nova entrasse — com a divergência aparecendo como campo que some conforme a
 * tela que o pediu.
 */
function paraView(e: {
  id: string;
  to: string;
  template: string;
  subject: string;
  status: string;
  attempts: number;
  error: string | null;
  providerMessageId: string | null;
  licenseId: string | null;
  createdAt: Date;
  sentAt: Date | null;
}): MailDeliveryView {
  return {
    id: e.id,
    to: e.to,
    template: e.template,
    subject: e.subject,
    status: e.status,
    attempts: e.attempts,
    error: e.error,
    providerMessageId: e.providerMessageId,
    licenseId: e.licenseId,
    createdAt: e.createdAt.toISOString(),
    sentAt: e.sentAt ? e.sentAt.toISOString() : null,
  };
}
