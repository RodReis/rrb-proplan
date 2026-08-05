import { Injectable, Logger, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { MailService, type MailDeliveryView } from '../../mail/application/mail.service';

/**
 * Operação das entregas de e-mail (FIX #254) — a segunda metade da aba
 * **Pendências**.
 *
 * ## A pergunta que faltava resposta
 *
 * A aba mostrava só *Entregas da plataforma*: "a venda virou licença?". Mas uma
 * chave emitida cujo e-mail nunca saiu é **exatamente uma pendência** — o
 * cliente pagou e não recebeu o que comprou. Esse estado existia apenas dentro
 * do detalhe de uma licença específica (`LicenseDetail.mailDeliveries`), ou
 * seja: para achar a falha era preciso já saber qual licença abrir — já saber a
 * resposta.
 *
 * A SPEC-038 §Escopo pedia *"falha visível no admin, não só no log"*. O registro
 * sempre esteve correto; o que faltava era a superfície que se pudesse varrer.
 *
 * ## Por que este service mora no `licensing`, e não no `mail`
 *
 * O `mail` é infraestrutura compartilhada e **não conhece licença** — a
 * arch-spec de lá varre exatamente isso. Mas reenfileirar exige os dados do
 * template de novo (eles nunca foram persistidos), e quem sabe remontá-los a
 * partir da licença é este módulo. Então a leitura e a escrita continuam sendo
 * do `MailService` (nada aqui escreve na tabela de entregas), e o que vive aqui
 * é a decisão de **quais entregas podem voltar à fila** e com que dados.
 *
 * **A frase acima não escreve o acessor do Prisma de propósito** (escrevia, até
 * 2026-08-05): os dois arch-specs que guardam esta fronteira — o daqui e o do
 * `mail` — varrem linha a linha e **não distinguem código de comentário**, então
 * a menção literal fazia as duas guardas acusarem justamente o parágrafo que
 * afirma o contrário.
 */

/** Uma entrega, com o veredito de reenvio já resolvido para a tela. */
export interface MailDeliveryOpsView extends MailDeliveryView {
  /**
   * `false` quando reenfileirar é impossível — hoje, só o `license_key`.
   *
   * Derivado aqui e não na tela pelo motivo de sempre: duas cópias da regra
   * divergem, e a divergência apareceria como botão que existe e sempre falha.
   */
  canRetry: boolean;
  /**
   * Por que não dá, em linguagem de quem opera, com o caminho que resolve.
   * `null` quando `canRetry` é `true`.
   */
  retryBlockedReason: string | null;
}

/**
 * O template cujo reenvio é **impossível por construção**.
 *
 * A chave em claro existe no objeto do job e em nenhum lugar persistido
 * (SPEC-036): o `MailDelivery` guarda `template` e `subject`, nunca o corpo.
 * Reenfileirar um `license_key` renderizaria o e-mail sem a chave — pior que
 * não reenviar, porque o comprador receberia uma mensagem dizendo que a chave
 * está ali.
 *
 * **Reemitir é o caminho** — ele gera chave nova e revoga a anterior, que é o
 * ato honesto quando a primeira se perdeu.
 */
const SEM_REENVIO = 'license_key';

const MOTIVO_SEM_REENVIO =
  'A chave não é guardada em lugar nenhum — reenviar mandaria um e-mail sem ela. Use Reemitir na licença: gera uma chave nova e revoga a anterior.';

@Injectable()
export class MailOpsService {
  private readonly logger = new Logger(MailOpsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
  ) {}

  /**
   * Entregas do tenant, com o veredito de reenvio em cada linha.
   *
   * A leitura é do `MailService` (fronteira do módulo `mail`); o que este
   * método acrescenta é o `canRetry`, que depende de conhecer os templates de
   * licença — coisa que o `mail` não deve conhecer.
   */
  async list(tenantId: string, status?: string): Promise<MailDeliveryOpsView[]> {
    const entregas = await this.mail.list(tenantId, status);
    return entregas.map((e) => ({
      ...e,
      canRetry: e.template !== SEM_REENVIO,
      retryBlockedReason: e.template === SEM_REENVIO ? MOTIVO_SEM_REENVIO : null,
    }));
  }

  /**
   * Reenfileira uma entrega, remontando os dados do template a partir da
   * licença.
   *
   * **O `license_key` é recusado com `422`**, não silenciosamente ignorado: a
   * tela já esconde o botão, e esta guarda é o que impede que uma chamada
   * direta produza um e-mail dizendo *"esta é a sua chave"* com o campo vazio.
   *
   * Entrega **sem licença** (`licenseId` nulo) também é recusada: o módulo
   * `mail` é compartilhado e o MVP3 vai mandar e-mail sem licença por trás —
   * quando isso existir, quem souber remontar aqueles dados oferece o próprio
   * caminho. Inventar um `data: {}` genérico renderizaria template quebrado.
   */
  async retry(tenantId: string, deliveryId: string): Promise<{ enqueued: true }> {
    const entrega = await this.mail.find(tenantId, deliveryId);
    // Busca por id, não varredura da lista: aquela trunca em 200, e uma falha
    // antiga responderia "não encontrada" — o mesmo beco que este FIX fecha.
    if (!entrega) throw new NotFoundException('Entrega não encontrada');

    if (entrega.template === SEM_REENVIO) {
      throw new UnprocessableEntityException(MOTIVO_SEM_REENVIO);
    }

    if (!entrega.licenseId) {
      throw new UnprocessableEntityException(
        'Entrega sem licença vinculada — não há de onde remontar os dados deste e-mail',
      );
    }

    const dados = await this.dadosDoTemplate(entrega.template, entrega.licenseId);
    await this.mail.retry(tenantId, deliveryId, dados);

    this.logger.log(`Entrega de e-mail ${deliveryId} reenfileirada pelo admin`);
    return { enqueued: true };
  }

  /**
   * Remonta o `data` do template a partir da licença.
   *
   * Cada template pede campos diferentes, e é por isso que este método existe em
   * vez de um objeto genérico: mandar a união de todos os campos faria o
   * template renderizar com o que sobrou de outro, e o sintoma seria um e-mail
   * torto na caixa do cliente — não um erro em log.
   */
  private async dadosDoTemplate(
    template: string,
    licenseId: string,
  ): Promise<Record<string, unknown>> {
    const licenca = await this.prisma.license.findUnique({
      where: { id: licenseId },
      select: {
        customerName: true,
        revokedReason: true,
        githubUsername: true,
        sourceInviteAt: true,
        edition: { select: { name: true, product: { select: { name: true } } } },
      },
    });
    if (!licenca) throw new NotFoundException('Licença da entrega não encontrada');

    const base = {
      customerName: licenca.customerName,
      productName: licenca.edition.product.name,
      editionName: licenca.edition.name,
    };

    if (template === 'license_revoked') {
      return {
        ...base,
        // O `revokedReason` é o motivo interno; o template pede o motivo em
        // linguagem do comprador. Quando não há, a frase neutra é melhor que um
        // campo vazio no meio da mensagem.
        reason: licenca.revokedReason?.trim() || 'A licença foi encerrada.',
      };
    }

    if (template === 'source_username_confirmed') {
      return {
        ...base,
        githubUsername: licenca.githubUsername ?? '',
        inviteAt: licenca.sourceInviteAt ? licenca.sourceInviteAt.toISOString() : null,
      };
    }

    // `source_username_request` fica de fora **de propósito**: a URL carrega um
    // token de uso único que não é persistido em claro (só o hash), então
    // remontá-la aqui é impossível pelo mesmo motivo da chave. O caminho é
    // reemitir o link, que já é um ato próprio no admin do source.
    throw new UnprocessableEntityException(
      `Reenvio não disponível para o template \`${template}\` — o link é de uso único e não é guardado. Reemita o link de coleta na licença.`,
    );
  }
}
