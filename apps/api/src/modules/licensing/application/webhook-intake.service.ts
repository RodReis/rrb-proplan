import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { Queue } from 'bullmq';
import { PrismaService } from '../../../prisma/prisma.service';
import { parseKiwifyEvent } from '../domain/kiwify-event';
import { verifySignature } from '../domain/webhook-signature';
import { LICENSING_QUEUE, PLATFORM_KIWIFY } from '../licensing.constants';

/**
 * O recebimento do webhook (SPEC-038 §Contratos).
 *
 * ## Receber ≠ processar
 *
 * Este service **grava e responde**. Quem entende o evento é o worker.
 *
 * O motivo está na §Notas técnicas: plataforma de pagamento tem timeout curto e
 * reenvia o que demora. Processar dentro da request transformaria uma emissão
 * lenta numa enxurrada de duplicatas — e o `@@unique(platform, externalEventId)`
 * é o que torna essa reentrega inofensiva.
 *
 * ## O tenant vem da URL, não do payload
 *
 * A rota é pública e não tem sessão. O `:tenantSlug` é o que estabelece o
 * contexto RLS **antes de qualquer leitura**, e é contra o `webhookSecret`
 * daquele tenant que a assinatura é validada: segredo do tenant A não vale na
 * URL do tenant B (decisão PI #1).
 *
 * Consequência que vale dizer: **evento de oferta não mapeada continua tendo
 * dono**. É justamente o caso que mais precisa aparecer no admin — e um evento
 * cujo tenant saísse do mapeamento seria invisível exatamente quando o
 * mapeamento é o que falta.
 */

export interface IntakeInput {
  tenantSlug: string;
  /** Bytes exatos do corpo. A assinatura cobre eles, não o objeto parseado. */
  rawBody: Buffer;
  payload: unknown;
  querySignature?: string;
  headers: Record<string, string | undefined>;
}

export interface WebhookJobData {
  webhookEventId: string;
  tenantId: string;
}

@Injectable()
export class WebhookIntakeService {
  private readonly logger = new Logger(WebhookIntakeService.name);

  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue(LICENSING_QUEUE) private readonly fila: Queue<WebhookJobData>,
  ) {}

  /**
   * Valida, grava e enfileira. Devolve `{ received: true }` em todos os
   * caminhos que não sejam assinatura inválida.
   *
   * **`200` inclusive para duplicado, desconhecido e o que vai falhar no
   * processamento** (§Contratos). O resultado vive no registro, não na
   * resposta: um `4xx` para evento que não conseguimos processar faria a
   * plataforma reenviar indefinidamente algo que nenhum reenvio conserta —
   * oferta sem mapeamento é o exemplo, e ela se resolve no admin.
   */
  async receive(input: IntakeInput): Promise<{ received: true }> {
    // `tenants` não tem RLS (é a raiz da tenancy): esta leitura funciona sem
    // contexto, e é ela que estabelece o contexto para todo o resto.
    const tenant = await this.prisma.tenant.findFirst({
      where: { accountLogin: input.tenantSlug },
      select: { id: true },
    });

    // Tenant inexistente responde `401`, o MESMO que assinatura inválida. São
    // dois fatos diferentes com uma resposta só de propósito: distinguir diria
    // a quem sonda quais slugs existem, e a rota é pública.
    if (!tenant) throw new UnauthorizedException('Assinatura inválida');

    return this.prisma.runInTenantContext([tenant.id], async () => {
      const settings = await this.prisma.licSettings.findUnique({
        where: { tenantId: tenant.id },
        select: { webhookSecret: true },
      });

      // Tenant sem configuração também é `401`. Ele não configurou webhook
      // nenhum, então nenhuma entrega para ele é legítima — e aceitar sem
      // segredo seria abrir a emissão de licença para quem descobrir o slug.
      //
      // **`!settings?.webhookSecret` e não só `!settings` desde o FIX #212**: a
      // coluna virou `String?`, e a linha passou a poder existir sem segredo
      // (criada ao salvar só o PAT do source). Sem esta metade da guarda, um
      // tenant nessa situação verificaria a assinatura contra `null` — e o
      // desfecho seria decidido pelo `verifySignature`, não por uma regra
      // explícita. O `401` aqui é o mesmo de antes, pelo mesmo motivo.
      if (
        !settings?.webhookSecret ||
        !verifySignature({
          rawBody: input.rawBody,
          // O `payload` também: a Kiwify assina o RE-STRINGIFY do objeto
          // parseado, não os bytes recebidos (documentação oficial, ambos os
          // exemplos). Verificar só o `rawBody` recusaria toda entrega
          // legítima cujo serializador diferisse do nosso em um espaço.
          payload: input.payload,
          secret: settings.webhookSecret,
          querySignature: input.querySignature,
          headers: input.headers,
        })
      ) {
        // Log com o slug e sem o corpo: saber que houve tentativa importa;
        // guardar o payload de quem não se autenticou, não.
        this.logger.warn(`Webhook recusado para ${input.tenantSlug}: assinatura inválida`);
        throw new UnauthorizedException('Assinatura inválida');
      }

      const evento = parseKiwifyEvent(input.payload);

      // Sem id externo não há idempotência possível: a segunda entrega da mesma
      // venda viraria outra linha, e outra licença. Recusar é o lado certo de
      // errar — e `401` mantém a resposta indistinguível das demais recusas.
      if (!evento.externalEventId) {
        this.logger.warn(`Webhook de ${input.tenantSlug} sem id de evento`);
        throw new UnauthorizedException('Assinatura inválida');
      }

      // A idempotência é do BANCO, não deste `if`: duas entregas simultâneas
      // passariam as duas por uma checagem prévia. O `catch` do unique é a
      // barreira real — a verificação abaixo só evita o caminho comum de
      // gravar-e-falhar.
      try {
        const registro = await this.prisma.licWebhookEvent.create({
          data: {
            tenantId: tenant.id,
            platform: PLATFORM_KIWIFY,
            externalEventId: evento.externalEventId,
            eventType: evento.eventType,
            // O payload BRUTO, como chegou. É o que torna o reprocessamento
            // possível sem pedir reenvio — e o que guarda o preço, que não vira
            // coluna (MVP4 decisão 4).
            payload: input.payload as never,
          },
          select: { id: true },
        });

        await this.fila.add(
          'process',
          { webhookEventId: registro.id, tenantId: tenant.id },
          {
            // 3 tentativas: as falhas daqui são de banco ou de código, não de
            // rede — o evento já está gravado, e o que não passa em 3 vezes não
            // passa em 10. O que sobra vira pendência no admin, com motivo.
            attempts: 3,
            backoff: { type: 'exponential', delay: 5_000 },
            removeOnComplete: 200,
            removeOnFail: 500,
          },
        );

        this.logger.log(
          `Webhook ${evento.eventType} recebido de ${input.tenantSlug} (evento ${registro.id})`,
        );
      } catch (erro) {
        // P2002 = unique violado: é a reentrega da plataforma, e ela é
        // NORMAL. Responder `200` sem gravar nada é exatamente o
        // comportamento pedido pelo critério de aceite.
        if (codigoPrisma(erro) === 'P2002') {
          this.logger.log(
            `Webhook ${evento.externalEventId} já recebido — reentrega ignorada`,
          );
          return { received: true as const };
        }
        throw erro;
      }

      return { received: true as const };
    });
  }
}

/** Código de erro do Prisma, sem importar o namespace só para o tipo. */
function codigoPrisma(erro: unknown): string | undefined {
  return typeof erro === 'object' && erro !== null && 'code' in erro
    ? String((erro as { code: unknown }).code)
    : undefined;
}
