import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { MailService } from '../../mail/application/mail.service';
import { generateKey, hashKey, updatesUntil } from '../domain/license-key';
import { parseKiwifyEvent, type ParsedEvent } from '../domain/kiwify-event';
import { PLATFORM_KIWIFY } from '../licensing.constants';

/**
 * O que o evento recebido significa para a licença (SPEC-038 §Escopo).
 *
 * Roda **no worker**, nunca na request. Cada caminho termina carimbando o
 * `LicWebhookEvent` com `PROCESSED`, `FAILED` ou `IGNORED` — e o carimbo é o
 * que o admin lê para decidir se reprocessa.
 *
 * ## Nenhum caminho aqui derruba o que já foi gravado
 *
 * O e-mail é **enfileirado**, nunca enviado em linha: um Resend fora do ar não
 * pode desfazer a emissão de uma licença paga (§Escopo → Módulo `mail`), e a
 * plataforma não reenvia o evento de compra por causa de um erro nosso.
 *
 * ## `sourceInviteAt` nasce aqui, o convite é da SPEC-039
 *
 * A compra da edição `source` agenda `compra + 8 dias`; reembolso ou chargeback
 * antes disso limpa o agendamento. O convite em si é a fatia seguinte — aqui só
 * se grava a data, para que o job daquela fatia não precise de migração.
 */

/** Dias entre a compra da edição `source` e o convite ao repo (SPEC-039). */
const DIAS_ATE_CONVITE = 8;

/** A edição que dá acesso ao código-fonte — a única que agenda convite. */
const EDICAO_SOURCE = 'source';

@Injectable()
export class WebhookProcessorService {
  private readonly logger = new Logger(WebhookProcessorService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
  ) {}

  /**
   * Processa um evento gravado. Chamado pelo worker **já dentro** do contexto
   * de tenant — sem ele, toda leitura devolveria zero linhas em silêncio.
   */
  async process(webhookEventId: string, tenantId: string): Promise<void> {
    const registro = await this.prisma.licWebhookEvent.findUnique({
      where: { id: webhookEventId },
    });
    if (!registro) {
      this.logger.warn(`Evento ${webhookEventId} não encontrado — nada a processar`);
      return;
    }

    // Já processado: o retry do BullMQ pode reentregar um job cujo worker
    // morreu depois do commit. Reprocessar emitiria a segunda licença da mesma
    // venda — e o `saleRef` único do banco recusaria, mas com erro em vez de
    // silêncio, enchendo a lista de pendências de falhas que não são falhas.
    if (registro.status === 'PROCESSED') {
      this.logger.log(`Evento ${webhookEventId} já processado`);
      return;
    }

    const evento = parseKiwifyEvent(registro.payload);

    try {
      const licenseId = await this.despachar(tenantId, evento);

      await this.prisma.licWebhookEvent.update({
        where: { id: webhookEventId },
        data: {
          // `ignore` vira IGNORED, e isso NÃO é falha: a plataforma acrescenta
          // tipos sem avisar, e tratar o desconhecido como erro encheria a
          // lista de pendências de coisas que não têm conserto.
          status: evento.action === 'ignore' ? 'IGNORED' : 'PROCESSED',
          processedAt: new Date(),
          licenseId,
          error: null,
        },
      });
    } catch (erro) {
      const mensagem = erro instanceof Error ? erro.message : String(erro);

      // FAILED com motivo legível e **retentável pelo admin**. É o caso da
      // oferta sem mapeamento: nenhum reenvio da plataforma resolve, mas
      // cadastrar o mapeamento e reprocessar, sim.
      await this.prisma.licWebhookEvent.update({
        where: { id: webhookEventId },
        data: {
          status: 'FAILED',
          processedAt: new Date(),
          error: mensagem.slice(0, 500),
        },
      });

      this.logger.warn(`Evento ${webhookEventId} falhou: ${mensagem}`);
      // NÃO relança: a falha é de dado (mapeamento ausente, licença não
      // encontrada), não de infraestrutura. Retentar três vezes o mesmo evento
      // sem mapeamento só adiaria o mesmo desfecho — e o admin já tem o item na
      // lista, com o motivo.
    }
  }

  /** Devolve o id da licença afetada, quando há uma. */
  private async despachar(
    tenantId: string,
    evento: ParsedEvent,
  ): Promise<string | null> {
    switch (evento.action) {
      case 'issue':
        return this.emitir(tenantId, evento);
      case 'revoke':
        return this.revogar(tenantId, evento);
      case 'renew':
        return this.renovar(tenantId, evento);
      case 'past_due':
        return this.marcarAtraso(tenantId, evento);
      case 'cancel':
        return this.cancelar(tenantId, evento);
      default:
        return null;
    }
  }

  /**
   * Compra aprovada → licença emitida + e-mail com a chave.
   *
   * **A chave em claro existe entre a linha que a gera e o `mail.send`.** Ela
   * não é persistida (SPEC-036) e não entra em log nem no payload do
   * `LicEvent` — é por isso que reenviar o e-mail não reenvia a chave.
   */
  private async emitir(tenantId: string, evento: ParsedEvent): Promise<string> {
    if (!evento.customerEmail) {
      throw new Error('Compra sem e-mail do comprador — licença não pode ser emitida');
    }

    // Reentrega que passou pela idempotência do recebimento (ex.: dois eventos
    // distintos para a mesma venda) para aqui. `saleRef` é único no banco, mas
    // encontrar antes evita transformar reentrega em erro na lista do admin.
    if (evento.saleRef) {
      const existente = await this.prisma.license.findFirst({
        where: { tenantId, saleRef: evento.saleRef },
        select: { id: true },
      });
      if (existente) {
        this.logger.log(`Venda ${evento.saleRef} já tem licença — nada a emitir`);
        return existente.id;
      }
    }

    const edicao = await this.resolverEdicao(tenantId, evento);

    const key = generateKey(edicao.product.keyPrefix);
    const issuedAt = new Date();

    const licenca = await this.prisma.license.create({
      data: {
        tenantId,
        editionId: edicao.id,
        keyHash: hashKey(key),
        customerEmail: evento.customerEmail,
        customerName: evento.customerName,
        saleRef: evento.saleRef ?? null,
        issuedAt,
        updatesUntil: updatesUntil(issuedAt, edicao.updatesMonths),
        // SUBSCRIPTION vence no fim do ciclo pago; PERPETUAL nunca vence.
        expiresAt:
          edicao.billingModel === 'SUBSCRIPTION' ? (evento.periodEndsAt ?? null) : null,
        // A edição `source` agenda o convite ao repo para o 8º dia (SPEC-039).
        // Aqui só a data — o convite é da fatia seguinte.
        sourceInviteAt:
          edicao.slug === EDICAO_SOURCE ? emDias(issuedAt, DIAS_ATE_CONVITE) : null,
        events: {
          create: {
            tenantId,
            type: 'webhook_issued',
            // A chave NÃO entra no payload — seria persisti-la por outro nome.
            //
            // O `subscriptionId` entra porque é por ele que a RENOVAÇÃO acha
            // esta licença meses depois: a cobrança de agosto traz um
            // `order_id` novo, que não casa com nenhum `saleRef`. Aqui e não em
            // coluna nova, para não mudar o schema do PR-1 por um caminho que o
            // `saleRef` já cobre no caso comum.
            payload: {
              saleRef: evento.saleRef ?? null,
              subscriptionId: evento.subscriptionId ?? null,
              editionSlug: edicao.slug,
            },
          },
        },
      },
      select: { id: true },
    });

    await this.mail.send({
      tenantId,
      to: evento.customerEmail,
      template: 'license_key',
      licenseId: licenca.id,
      data: {
        customerName: evento.customerName,
        licenseKey: key,
        productName: edicao.product.name,
        editionName: edicao.name,
      },
    });

    // Log sem a chave e sem o hash: o hash é o que a busca usa, e registrá-lo
    // daria a quem lê o log o mesmo poder de lookup que o banco dá.
    this.logger.log(`Licença ${licenca.id} emitida pela venda ${evento.saleRef}`);
    return licenca.id;
  }

  /**
   * Reembolso ou chargeback → `REVOKED` + e-mail de aviso.
   *
   * **Limpa `sourceInviteAt`**: reembolso antes do 8º dia cancela o convite ao
   * repo privado que ainda não saiu (§Escopo). Sem isso, quem pediu o dinheiro
   * de volta ganharia acesso ao código uma semana depois.
   */
  private async revogar(tenantId: string, evento: ParsedEvent): Promise<string> {
    const licenca = await this.encontrar(tenantId, evento);
    const motivo = evento.revokeReason ?? 'revogada pela plataforma';

    // Idempotente: revogar de novo não reescreve a data original nem manda um
    // segundo e-mail. A 1ª revogação é o fato; a 2ª é reentrega.
    if (licenca.status === 'REVOKED') return licenca.id;

    await this.prisma.license.update({
      where: { id: licenca.id },
      data: {
        status: 'REVOKED',
        revokedAt: new Date(),
        revokedReason: motivo,
        sourceInviteAt: null,
        events: { create: { tenantId, type: 'webhook_revoked', payload: { motivo } } },
      },
    });

    await this.mail.send({
      tenantId,
      to: licenca.customerEmail,
      template: 'license_revoked',
      licenseId: licenca.id,
      data: {
        customerName: licenca.customerName,
        productName: licenca.edition.product.name,
        reason: motivo,
      },
    });

    this.logger.log(`Licença ${licenca.id} revogada por ${motivo}`);
    return licenca.id;
  }

  /**
   * Renovação → estende `expiresAt` **e limpa `pastDueAt`**.
   *
   * **O caminho de volta é obrigatório** (decisão PI #3): sem ele, o cliente
   * que pagou fica travado até alguém mexer no admin, e o corte automático vira
   * fila de suporte. Os dois campos mudam na MESMA escrita — separá-los abriria
   * uma janela em que a licença está paga e cortada ao mesmo tempo.
   */
  private async renovar(tenantId: string, evento: ParsedEvent): Promise<string> {
    const licenca = await this.encontrar(tenantId, evento);

    // Renovação repetida não estende duas vezes: a data vem do evento (fim do
    // ciclo informado pela plataforma), não de `expiresAt + 1 mês`. Somar
    // faria cada reentrega presentear o cliente com outro mês.
    const novaExpiracao = evento.periodEndsAt ?? licenca.expiresAt;

    await this.prisma.license.update({
      where: { id: licenca.id },
      data: {
        expiresAt: novaExpiracao,
        pastDueAt: null,
        // Renovar ressuscita quem a plataforma tinha revogado? Não. `status`
        // fica intocado: reembolso e chargeback são decisões de dinheiro, e uma
        // renovação posterior não desfaz um estorno.
        events: {
          create: {
            tenantId,
            type: 'webhook_renewed',
            payload: { expiresAt: novaExpiracao?.toISOString() ?? null },
          },
        },
      },
    });

    this.logger.log(`Licença ${licenca.id} renovada até ${novaExpiracao?.toISOString()}`);
    return licenca.id;
  }

  /**
   * Atraso → marca `pastDueAt` e **mantém `status = ACTIVE`**.
   *
   * Cartão recusado é rotina, e a própria plataforma retenta. Derrubar o acesso
   * no primeiro atraso pune o cliente por um evento que vai se resolver sozinho
   * — o corte só vem depois de `pastDueToleranceDays`, e a comparação mora na
   * validação (PR-4), nunca aqui.
   */
  private async marcarAtraso(tenantId: string, evento: ParsedEvent): Promise<string> {
    const licenca = await this.encontrar(tenantId, evento);

    // Já em atraso: não reescreve a data. O relógio da tolerância conta do
    // PRIMEIRO atraso — reiniciá-lo a cada retry da plataforma faria a
    // tolerância nunca vencer.
    if (licenca.pastDueAt) return licenca.id;

    await this.prisma.license.update({
      where: { id: licenca.id },
      data: {
        pastDueAt: new Date(),
        events: { create: { tenantId, type: 'webhook_past_due', payload: {} } },
      },
    });

    this.logger.log(`Licença ${licenca.id} marcada em atraso`);
    return licenca.id;
  }

  /**
   * Cancelamento → **preserva `expiresAt`** (decisão PI #2).
   *
   * Quem cancelou pagou o ciclo corrente: o acesso vai até o fim dele. Corte
   * imediato fica para reembolso e chargeback, onde o dinheiro voltou.
   */
  private async cancelar(tenantId: string, evento: ParsedEvent): Promise<string> {
    const licenca = await this.encontrar(tenantId, evento);

    await this.prisma.license.update({
      where: { id: licenca.id },
      data: {
        // `expiresAt` intocado de propósito. Depois dessa data, `/activate` e
        // `/heartbeat` respondem `410` pela comparação da validação — sem
        // depender de job nenhum ter rodado.
        events: {
          create: {
            tenantId,
            type: 'webhook_canceled',
            payload: { expiresAt: licenca.expiresAt?.toISOString() ?? null },
          },
        },
      },
    });

    this.logger.log(`Assinatura da licença ${licenca.id} cancelada`);
    return licenca.id;
  }

  /**
   * Acha a licença do evento. Três caminhos, nesta ordem.
   *
   * **1. `saleRef`** — o vínculo forte, e o que basta para reembolso e
   * chargeback: eles chegam com o `order_id` da venda original.
   *
   * **2. `subscriptionId`** — o resgate dos eventos de assinatura. A renovação
   * de agosto traz um `order_id` NOVO (é outra cobrança), que não existe em
   * nenhuma licença; sem este caminho, toda renovação falharia com "licença não
   * encontrada" e o acesso morreria com a assinatura em dia. A Kiwify manda
   * `subscription_id` em todo evento recorrente.
   *
   * **3. E-mail** — último recurso, restrito à licença mais recente: quem
   * comprou duas vezes tem duas, e a antiga não é a que está sendo renovada.
   *
   * O `subscriptionId` é gravado no `LicEvent` da emissão, não numa coluna —
   * `License` não tem campo para ele, e criar um seria mudar o schema do PR-1
   * por um caminho que a busca por `saleRef` já cobre no caso comum.
   */
  private async encontrar(tenantId: string, evento: ParsedEvent) {
    const licenca =
      (evento.saleRef ? await this.porSaleRef(tenantId, evento.saleRef) : null) ??
      (evento.subscriptionId
        ? await this.porAssinatura(tenantId, evento.subscriptionId)
        : null) ??
      (evento.customerEmail ? await this.porEmail(tenantId, evento.customerEmail) : null);

    if (!licenca) {
      // Mensagem com tudo que foi procurado: é o que o admin lê para entender
      // que o evento chegou antes da compra (ordem invertida) ou que a venda
      // veio de fora do mapeamento.
      throw new Error(
        `Licença não encontrada (venda ${evento.saleRef ?? '—'}, ` +
          `assinatura ${evento.subscriptionId ?? '—'}, ${evento.customerEmail ?? '—'})`,
      );
    }
    return licenca;
  }

  private porSaleRef(tenantId: string, saleRef: string) {
    return this.prisma.license.findFirst({
      where: { tenantId, saleRef },
      include: { edition: { include: { product: true } } },
    });
  }

  /**
   * Pela assinatura, via trilha: o `subscriptionId` foi gravado no payload do
   * `webhook_issued` na emissão.
   */
  private async porAssinatura(tenantId: string, subscriptionId: string) {
    const evento = await this.prisma.licEvent.findFirst({
      where: {
        tenantId,
        type: 'webhook_issued',
        payload: { path: ['subscriptionId'], equals: subscriptionId },
      },
      orderBy: { createdAt: 'desc' },
      select: { licenseId: true },
    });
    if (!evento) return null;

    return this.prisma.license.findFirst({
      where: { id: evento.licenseId, tenantId },
      include: { edition: { include: { product: true } } },
    });
  }

  private porEmail(tenantId: string, customerEmail: string) {
    return this.prisma.license.findFirst({
      where: { tenantId, customerEmail },
      include: { edition: { include: { product: true } } },
      orderBy: { issuedAt: 'desc' },
    });
  }

  /**
   * Oferta → edição, pelo mapeamento (§Escopo).
   *
   * **Compra sem mapeamento não emite licença.** Adivinhar a edição pelo nome
   * do produto emitiria a licença errada em silêncio — e licença errada
   * entregue por e-mail não se recolhe. A mensagem carrega o identificador da
   * oferta, que é o que o admin precisa para cadastrar o mapeamento e
   * reprocessar.
   */
  private async resolverEdicao(tenantId: string, evento: ParsedEvent) {
    if (!evento.externalProductId) {
      throw new Error('Compra sem identificador de produto na plataforma');
    }

    const mapeamento = await this.prisma.licOfferMapping.findFirst({
      where: {
        tenantId,
        platform: PLATFORM_KIWIFY,
        externalProductId: evento.externalProductId,
        // A oferta específica vence o curinga: `orderBy` põe a linha com
        // `externalOfferId` preenchido primeiro. É o que faz "anual" e "mensal"
        // do mesmo produto apontarem para edições diferentes.
        OR: [{ externalOfferId: evento.externalOfferId ?? null }, { externalOfferId: null }],
      },
      orderBy: { externalOfferId: 'desc' },
      include: { edition: { include: { product: true } } },
    });

    if (!mapeamento) {
      throw new Error(
        `Oferta sem mapeamento: produto ${evento.externalProductId}` +
          `, oferta ${evento.externalOfferId ?? '(nenhuma)'}`,
      );
    }
    return mapeamento.edition;
  }
}

function emDias(base: Date, dias: number): Date {
  return new Date(base.getTime() + dias * 24 * 60 * 60 * 1000);
}
