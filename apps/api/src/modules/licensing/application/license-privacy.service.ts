import {
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import {
  ANONIMO_DESTINATARIO,
  ANONIMO_EMAIL,
  ANONIMO_NOME,
  redigirPayload,
} from '../domain/anonymize';

/**
 * As duas ações do painel que mexem no que já foi decidido (SPEC-040):
 * **estender** a validade e **excluir o dado pessoal a pedido**.
 *
 * Estão juntas num service próprio, e não no `license-admin`, porque as duas
 * são atos administrativos sobre uma licença **viva** — carimbados, com autor e
 * motivo obrigatórios. O `license-admin` responde "emita, liste, revogue"; aqui
 * mora o que só acontece quando alguém pede.
 */

const MAX_MOTIVO = 500;

export interface ExtendResult {
  id: string;
  expiresAt: string | null;
  /** O que estava lá antes — a tela mostra os dois para o operador conferir. */
  previousExpiresAt: string | null;
}

export interface AnonymizeResult {
  id: string;
  /** Quantas entregas de e-mail tiveram o destinatário redigido. */
  mailDeliveries: number;
  /** Quantos eventos de webhook tiveram o payload reduzido. */
  webhookEvents: number;
  /** Quantos relatos de erro foram apagados (SPEC-043 §Escopo). */
  errorReports: number;
}

@Injectable()
export class LicensePrivacyService {
  private readonly logger = new Logger(LicensePrivacyService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Estende a validade da licença — **conserto pontual, não segunda fonte de
   * verdade** (§Estender).
   *
   * `expiresAt` tem uma autoridade: a plataforma, desde a SPEC-038. Duas
   * autoridades permanentes sobre a mesma data significam divergência que só
   * aparece quando alguém for cobrado errado. Esta extensão **assume** que o
   * próximo evento de renovação vence — o que a torna administrável é o aviso
   * na tela e o **valor anterior gravado no evento**, que é o que permite
   * responder "quem prometeu o quê" seis meses depois.
   *
   * O motivo é obrigatório pelo mesmo raciocínio do motivo da revogação
   * (SPEC-036): extensão sem motivo é a que ninguém consegue explicar quando o
   * cliente cobra o que foi prometido.
   */
  async extend(
    tenantId: string,
    licenseId: string,
    authorId: string,
    input: { until?: unknown; reason?: unknown },
  ): Promise<ExtendResult> {
    const motivo = texto(input.reason).slice(0, MAX_MOTIVO);
    if (!motivo) {
      throw new UnprocessableEntityException('Informe o motivo da extensão');
    }

    const until = data(input.until);
    if (!until) {
      throw new UnprocessableEntityException('Informe a nova data de validade');
    }

    const licenca = await this.prisma.license.findFirst({
      where: { id: licenseId, tenantId },
      select: { id: true, status: true, expiresAt: true },
    });
    if (!licenca) throw new NotFoundException('Licença não encontrada');

    // Estender licença revogada afirmaria que ela voltou a valer — e ela não
    // volta: o `/activate` responde `410` pelo `status`, não pela data. O
    // operador que quer desfazer uma revogação precisa de outro ato, não deste.
    if (licenca.status === 'REVOKED') {
      throw new UnprocessableEntityException(
        'Licença revogada não é estendida — a revogação é o que corta o acesso',
      );
    }

    // Encurtar é permitido de propósito: o caso real é desfazer uma extensão
    // digitada errada, e proibir obrigaria a mexer no banco para consertar um
    // erro cometido nesta mesma tela.
    const anterior = licenca.expiresAt;

    const atualizada = await this.prisma.license.update({
      where: { id: licenseId },
      data: {
        expiresAt: until,
        events: {
          create: {
            tenantId,
            type: 'extended_by_admin',
            // **Autor, motivo e valor anterior** (§Estender). Sem o anterior,
            // a trilha diz que a data mudou e não diz de quê — e a pergunta
            // que se faz depois é sempre "mudou a partir de quando?".
            payload: {
              authorId,
              reason: motivo,
              previousExpiresAt: anterior ? anterior.toISOString() : null,
              newExpiresAt: until.toISOString(),
            },
          },
        },
      },
      select: { id: true, expiresAt: true },
    });

    this.logger.log(
      `Licença ${licenseId} estendida por ${authorId} até ${until.toISOString()}: ${motivo}`,
    );

    return {
      id: atualizada.id,
      expiresAt: atualizada.expiresAt ? atualizada.expiresAt.toISOString() : null,
      previousExpiresAt: anterior ? anterior.toISOString() : null,
    };
  }

  /**
   * Exclusão a pedido: **anonimiza o dado pessoal, preserva a transação**
   * (§Exclusão a pedido).
   *
   * O direito é sobre dado pessoal, não sobre o fato da venda. Ficam a licença,
   * as ativações, a trilha e o `saleRef`; saem e-mail, nome e username da
   * licença, o destinatário das entregas e os campos pessoais do payload bruto.
   *
   * **Não há coluna "está anonimizado"** (§Modelo): o estado é derivável do
   * `LicEvent` `anonymized`, e uma coluna paralela abriria a chance de o flag
   * dizer uma coisa e o dado dizer outra.
   *
   * **Tudo numa transação.** Metade feita é o pior desfecho possível: o titular
   * recebeu a confirmação de que os dados saíram, e o e-mail dele continua no
   * payload do webhook porque a segunda escrita falhou.
   */
  async anonymize(
    tenantId: string,
    licenseId: string,
    authorId: string,
    input: { reason?: unknown },
  ): Promise<AnonymizeResult> {
    const motivo = texto(input.reason).slice(0, MAX_MOTIVO);
    if (!motivo) {
      throw new UnprocessableEntityException('Informe o motivo da exclusão');
    }

    const licenca = await this.prisma.license.findFirst({
      where: { id: licenseId, tenantId },
      select: { id: true, customerEmail: true },
    });
    if (!licenca) throw new NotFoundException('Licença não encontrada');

    // Os payloads são lidos antes da transação porque cada um é redigido
    // individualmente — não há `UPDATE` em massa que reduza um JSON a uma
    // allowlist de campos.
    const eventos = await this.prisma.licWebhookEvent.findMany({
      where: { licenseId },
      select: { id: true, payload: true },
    });

    const resultado = await this.prisma.$transaction(async (tx) => {
      await tx.license.update({
        where: { id: licenseId },
        data: {
          customerEmail: ANONIMO_EMAIL,
          customerName: ANONIMO_NOME,
          // O username do GitHub sai junto: ele é dado pessoal (identifica a
          // pessoa numa rede pública) e está marcado como tal no schema.
          //
          // **O acesso ao repositório NÃO é revogado aqui.** Excluir dado
          // pessoal não desfaz a compra — quem comprou o código-fonte
          // continua com direito a ele. Amarrar as duas coisas faria um
          // pedido de LGPD virar cancelamento de um produto pago.
          githubUsername: null,
        },
      });

      const entregas = await tx.mailDelivery.updateMany({
        where: { licenseId },
        data: { to: ANONIMO_DESTINATARIO },
      });

      // **Relatos de erro são APAGADOS, não redigidos** (SPEC-043 §Escopo).
      //
      // As outras duas linhas anonimizam porque o que fica tem valor sem o dado
      // pessoal: a entrega prova que o e-mail saiu, o payload prova que a venda
      // chegou. Um relato de erro é diferente — `sessionTail` são nomes de
      // arquivos e trechos do projeto do titular, e `contactEmail` é um endereço
      // que ele digitou. Redigir esses campos deixaria a linha sem nada além de
      // uma stack órfã, e manter a stack não vale o risco de ter errado a
      // redação de um campo livre que veio de fora.
      const relatos = await tx.licErrorReport.deleteMany({ where: { licenseId } });

      for (const evento of eventos) {
        await tx.licWebhookEvent.update({
          where: { id: evento.id },
          data: {
            payload: redigirPayload(evento.payload) as unknown as Prisma.InputJsonValue,
          },
        });
      }

      // O evento é a ÚLTIMA escrita, e por isso ele conta o que de fato
      // aconteceu. Criá-lo junto do `update` da licença exigiria adivinhar os
      // números antes de executar — e o carimbo diria "3 entregas redigidas"
      // num caso em que só duas foram.
      await tx.licEvent.create({
        data: {
          tenantId,
          licenseId,
          type: 'anonymized',
          // O evento fica, o dado sai: nem o e-mail nem o nome entram no
          // payload — seria reintroduzi-los pela porta da trilha.
          payload: {
            authorId,
            reason: motivo,
            mailDeliveries: entregas.count,
            webhookEvents: eventos.length,
            errorReports: relatos.count,
          },
        },
      });

      return {
        mailDeliveries: entregas.count,
        webhookEvents: eventos.length,
        errorReports: relatos.count,
      };
    });

    // Log sem o e-mail original: registrá-lo aqui manteria o dado pessoal vivo
    // no log da aplicação — o mesmo vazamento por outro caminho.
    this.logger.log(
      `Licença ${licenseId} anonimizada por ${authorId}: ${motivo} ` +
        `(${resultado.mailDeliveries} entregas, ${resultado.webhookEvents} eventos, ` +
        `${resultado.errorReports} relatos)`,
    );

    return { id: licenseId, ...resultado };
  }
}

/** `unknown` → string aparada. Entrada de rota nunca é confiável de tipo. */
function texto(valor: unknown): string {
  return typeof valor === 'string' ? valor.trim() : '';
}

/**
 * `unknown` → `Date` válida, ou `null`.
 *
 * Data inválida vira `null` e a rota recusa, em vez de virar `Invalid Date` e
 * chegar ao Prisma: o erro do banco diria "invalid input syntax" sobre um campo
 * que o operador acabou de digitar na tela.
 */
function data(valor: unknown): Date | null {
  if (typeof valor !== 'string' || !valor.trim()) return null;
  const d = new Date(valor);
  return Number.isNaN(d.getTime()) ? null : d;
}
