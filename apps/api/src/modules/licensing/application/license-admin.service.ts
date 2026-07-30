import {
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { LicenseStatus } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { generateKey, hashKey, updatesUntil } from '../domain/license-key';

/**
 * Emissão manual e revogação de licenças (SPEC-036 §Escopo).
 *
 * ## A garantia que este service existe para manter
 *
 * **A chave em claro aparece uma única vez, na resposta desta emissão.** Ela
 * não é persistida (só o `keyHash`), não é logada, e nenhuma leitura posterior
 * a devolve. `IssuedLicense.key` é o único lugar do sistema onde ela existe
 * depois de gerada — o que sai daqui em qualquer outro caminho é `LicenseView`,
 * que não tem o campo.
 *
 * Duas consequências que valem dizer em voz alta, porque são o preço da
 * decisão: perder a chave significa **emitir outra** (não há recuperação), e o
 * suporte não consegue ler a chave do comprador para conferir — ele confere
 * pelo hash, que é o que a busca por chave faz.
 *
 * ## Emissão é manual nesta fatia
 *
 * O admin digita e-mail e nome; a entrega é dele, por fora. O e-mail
 * transacional e o webhook da plataforma de venda são a SPEC-038 — é lá que
 * `saleRef` deixa de ser nulo e vira a idempotência da reentrega.
 */

/** O que a emissão devolve — o ÚNICO tipo que carrega a chave em claro. */
export interface IssuedLicense extends LicenseView {
  /**
   * Chave em claro. Exibida uma vez e descartada: não existe em nenhuma tabela
   * e nenhuma outra rota a devolve.
   */
  key: string;
}

export interface LicenseView {
  id: string;
  status: LicenseStatus;
  customerEmail: string;
  customerName: string | null;
  editionSlug: string;
  editionName: string;
  productSlug: string;
  issuedAt: string;
  updatesUntil: string;
  expiresAt: string | null;
  revokedAt: string | null;
  revokedReason: string | null;
  /** Máquinas em uso — o que o `/activate` conta contra `maxMachines`. */
  activeMachines: number;
  maxMachines: number;
}

/** Uma máquina, como o admin a vê (SPEC-037 §Contratos → Admin). */
export interface ActivationView {
  id: string;
  fingerprint: string;
  hostname: string | null;
  appVersion: string | null;
  activatedAt: string;
  lastSeenAt: string;
  /** Preenchido = fora da contagem de vagas, mas ainda legível aqui. */
  deactivatedAt: string | null;
}

/** Uma entrega de e-mail, como o detalhe a mostra (SPEC-040 §Busca e detalhe). */
export interface MailDeliveryView {
  id: string;
  to: string;
  template: string;
  subject: string;
  status: string;
  attempts: number;
  error: string | null;
  createdAt: string;
  sentAt: string | null;
}

/** Detalhe da licença: a `LicenseView` + as máquinas + o sinal de troca. */
export interface LicenseDetail extends LicenseView {
  activations: ActivationView[];
  /**
   * Estado do acesso ao repo privado (SPEC-039). Vem para o detalhe porque a
   * pergunta *"o que aconteceu com este cliente"* inclui "ele recebeu o
   * código-fonte?", e hoje essa resposta só existe na lista de pendências —
   * que só mostra quem está travado.
   */
  sourceAccess: string;
  githubUsername: string | null;
  sourceAccessError: string | null;
  sourceInviteAt: string | null;
  /** Id da venda na plataforma. É por ele que se confere o dinheiro lá fora. */
  saleRef: string | null;
  /** Inadimplência registrada sem mudar `status` (SPEC-038). */
  pastDueAt: string | null;
  /**
   * E-mails que saíram por causa desta licença. **O que o suporte pergunta
   * primeiro** quando o cliente diz que não recebeu a chave — e sem isto a
   * resposta exigia abrir a seção de entregas e filtrar na mão.
   */
  mailDeliveries: MailDeliveryView[];
  /**
   * A trilha completa, na mesma resposta. O `GET /licenses/:id/events` continua
   * existindo (SPEC-036) e não muda de caminho — mas o detalhe que exige duas
   * requisições para responder uma pergunta é o que a spec chama de *"responde
   * numa tela só"* não cumprido.
   */
  events: LicEventView[];
  /**
   * Desativações + reativações na janela (SPEC-037 §Escopo). É **sinal, não
   * limite**: nada bloqueia (decisão 1 do PI). Teto errado bloquearia o cliente
   * honesto que formatou o PC duas vezes, e o volume do piloto permite olhar
   * caso a caso.
   */
  swapCount: number;
  /** Dias da janela do contador — para a tela dizer "trocas em N dias". */
  swapWindowDays: number;
}

export interface LicEventView {
  id: string;
  type: string;
  payload: unknown;
  createdAt: string;
}

export interface IssueLicenseInput {
  editionId?: unknown;
  customerEmail?: unknown;
  customerName?: unknown;
}

/**
 * Formato de e-mail: barra o erro de digitação óbvio antes de gravar. Não
 * valida existência da caixa — isso quem responde é a entrega (SPEC-038); o
 * que este teste evita é uma licença cujo dono ninguém consegue identificar.
 */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const MAX_MOTIVO = 500;

/**
 * Janela do contador de trocas (SPEC-037 §Escopo). 30 dias: curto o bastante
 * para que um pico recente apareça, longo o bastante para não zerar entre duas
 * trocas legítimas do mesmo mês.
 *
 * ponytail: janela fixa, não configurável. Vira parâmetro quando houver um
 * segundo produto com padrão de uso diferente — o gatilho é o mesmo do
 * `graceDays` (decisão 2 do PI).
 */
const SWAP_WINDOW_DAYS = 30;

@Injectable()
export class LicenseAdminService {
  private readonly logger = new Logger(LicenseAdminService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Emite uma licença e devolve a chave **uma única vez**.
   *
   * A colisão de `keyHash` (unique do banco) não é tratada com retry: com 80
   * bits de entropia ela não acontece na prática, e um retry silencioso
   * esconderia um gerador quebrado — que é a única causa realista de duas
   * chaves iguais. O erro do banco sobe.
   */
  async issue(tenantId: string, input: IssueLicenseInput): Promise<IssuedLicense> {
    const editionId = texto(input.editionId);
    const customerEmail = texto(input.customerEmail).toLowerCase();
    const customerName = texto(input.customerName) || null;

    if (!editionId) {
      throw new UnprocessableEntityException('Escolha a edição da licença');
    }
    if (!EMAIL_RE.test(customerEmail)) {
      throw new UnprocessableEntityException('E-mail do comprador inválido');
    }

    // A edição traz o produto: é dele que sai o `keyPrefix` (MVP4 §4). O RLS
    // já corta por tenant — `lic_editions` pela policy de JOIN no produto.
    const edicao = await this.prisma.licEdition.findFirst({
      where: { id: editionId, product: { tenantId } },
      include: { product: true },
    });
    if (!edicao) {
      throw new NotFoundException('Edição não encontrada');
    }

    const key = generateKey(edicao.product.keyPrefix);
    const issuedAt = new Date();

    const licenca = await this.prisma.license.create({
      data: {
        tenantId,
        editionId: edicao.id,
        keyHash: hashKey(key),
        customerEmail,
        customerName,
        issuedAt,
        // Copiado da edição, nunca lido por FK (§Contratos): mudar a política
        // depois não pode encurtar a janela de quem já comprou.
        updatesUntil: updatesUntil(issuedAt, edicao.updatesMonths),
        // Nulo em PERPETUAL. A SPEC-038 preenche em SUBSCRIPTION, a cada
        // pagamento.
        expiresAt: null,
        events: {
          // Mesma transação implícita do `create` aninhado: uma licença sem o
          // `issued` na trilha seria uma emissão que a auditoria não vê.
          create: {
            tenantId,
            type: 'issued',
            // A chave NÃO entra no payload — seria persisti-la por outro nome.
            payload: { editionSlug: edicao.slug, customerEmail },
          },
        },
      },
      include: { edition: { include: { product: true } } },
    });

    // Log sem a chave e sem o hash: o hash é o que a busca usa, e registrá-lo
    // no log daria a quem lê o log o mesmo poder de lookup que o banco dá.
    this.logger.log(
      `Licença ${licenca.id} emitida (${edicao.product.slug}/${edicao.slug}) para ${customerEmail}`,
    );

    return { ...this.toView(licenca, 0), key };
  }

  /**
   * Licenças do tenant, mais recentes primeiro. Nunca devolve a chave.
   *
   * **A busca é um campo só, casando cinco colunas** (SPEC-040 §Busca e
   * detalhe): e-mail, nome, `saleRef`, username do GitHub e a chave. O operador
   * cola o que o cliente mandou — e o que ele mandou varia com o canal por onde
   * reclamou, não com a coluna que o banco tem.
   *
   * **A chave entra por hash exato, as outras quatro por `contains`.** Não é
   * inconsistência: hash não tem prefixo em comum com nada, então `contains`
   * sobre `keyHash` só acharia por acidente. O `hashKey` do termo é somado ao
   * `OR` de propósito — uma busca que não fosse a chave produz um hash que não
   * casa com linha nenhuma, e o custo é uma comparação de índice.
   *
   * `status` filtra por cima da busca, não no lugar dela.
   */
  async list(
    tenantId: string,
    q?: string,
    status?: LicenseStatus,
  ): Promise<LicenseView[]> {
    const termo = texto(q);
    const licencas = await this.prisma.license.findMany({
      where: {
        tenantId,
        ...(status ? { status } : {}),
        ...(termo
          ? {
              OR: [
                { customerEmail: { contains: termo.toLowerCase() } },
                // `insensitive`: o nome é digitado pelo comprador com as
                // maiúsculas que ele quis, e buscar "silva" não pode falhar
                // porque a linha diz "Silva".
                { customerName: { contains: termo, mode: 'insensitive' as const } },
                { saleRef: { contains: termo } },
                { githubUsername: { contains: termo, mode: 'insensitive' as const } },
                { keyHash: hashKey(termo) },
              ],
            }
          : {}),
      },
      include: {
        edition: { include: { product: true } },
        // Só as vivas: `deactivatedAt` preenchido saiu da contagem de vagas
        // (o `/deactivate` da SPEC-037) sem sair da trilha.
        activations: { where: { deactivatedAt: null }, select: { id: true } },
      },
      orderBy: { issuedAt: 'desc' },
      take: 200,
    });

    return licencas.map((l) => this.toView(l, l.activations.length));
  }

  /**
   * Busca pela chave: hasheia o que foi digitado e procura pelo `keyHash`
   * (§Contratos). É o caminho do suporte — o comprador manda a chave, o admin
   * cola aqui, e o servidor confere sem nunca ter guardado o valor.
   *
   * Não valida o formato antes: a chave pode ser de um produto com outro
   * prefixo, e o `isWellFormedKey` precisa saber qual. Um hash que não casa
   * devolve vazio, que é a mesma resposta de uma chave inexistente.
   */
  async findByKey(tenantId: string, key: string): Promise<LicenseView | null> {
    const chave = texto(key);
    if (!chave) return null;

    const licenca = await this.prisma.license.findFirst({
      // `tenantId` no where além do RLS: a busca por hash é global por
      // construção (o índice é único na tabela inteira), e sem o filtro
      // explícito o RLS seria a ÚNICA coisa entre o admin de um tenant e a
      // licença de outro. Duas barreiras para o mesmo corte, de propósito.
      where: { keyHash: hashKey(chave), tenantId },
      include: {
        edition: { include: { product: true } },
        activations: { where: { deactivatedAt: null }, select: { id: true } },
      },
    });

    return licenca ? this.toView(licenca, licenca.activations.length) : null;
  }

  /**
   * Revoga: `status = REVOKED` + `revokedAt` + motivo. É o que faz o
   * `/activate` responder `410` (PR-3).
   *
   * Os dois campos vão juntos porque o CHECK do banco (PR-1) exige — e ele
   * exige porque `status = REVOKED` sem data deixaria a trilha sem o dia em
   * que a venda foi desfeita, e o inverso produziria ativação indevida depois
   * de um reembolso.
   *
   * **Não apaga ativação nenhuma.** As máquinas continuam listadas: a licença
   * morreu, o histórico de quem a usou não.
   */
  async revoke(
    tenantId: string,
    licenseId: string,
    reason: string,
  ): Promise<LicenseView> {
    const motivo = texto(reason).slice(0, MAX_MOTIVO);
    if (!motivo) {
      // Revogação sem motivo é a que ninguém consegue explicar meses depois,
      // quando o comprador reclama. O campo é curto de propósito.
      throw new UnprocessableEntityException('Informe o motivo da revogação');
    }

    const licenca = await this.prisma.license.findFirst({
      where: { id: licenseId, tenantId },
      include: { edition: { include: { product: true } } },
    });
    if (!licenca) throw new NotFoundException('Licença não encontrada');

    // Idempotente: revogar de novo não reescreve a data original nem duplica o
    // evento. A 1ª revogação é o fato; a 2ª é um clique repetido.
    if (licenca.status === 'REVOKED') {
      const vivas = await this.prisma.activation.count({
        where: { licenseId, deactivatedAt: null },
      });
      return this.toView(licenca, vivas);
    }

    const atualizada = await this.prisma.license.update({
      where: { id: licenseId },
      data: {
        status: 'REVOKED',
        revokedAt: new Date(),
        revokedReason: motivo,
        events: { create: { tenantId, type: 'revoked', payload: { reason: motivo } } },
      },
      include: {
        edition: { include: { product: true } },
        activations: { where: { deactivatedAt: null }, select: { id: true } },
      },
    });

    this.logger.log(`Licença ${licenseId} revogada: ${motivo}`);
    return this.toView(atualizada, atualizada.activations.length);
  }

  /**
   * Detalhe da licença: as máquinas (inclusive as desativadas) e o contador de
   * trocas da janela (SPEC-037 §Contratos → Admin).
   *
   * **As desativadas aparecem aqui e não na contagem de vagas.** É a diferença
   * que o suporte precisa: "esta máquina existiu e saiu em tal data" responde
   * a pergunta que uma lista só das vivas não responde.
   */
  async detail(tenantId: string, licenseId: string): Promise<LicenseDetail> {
    const licenca = await this.prisma.license.findFirst({
      where: { id: licenseId, tenantId },
      include: {
        edition: { include: { product: true } },
        activations: { orderBy: { activatedAt: 'asc' } },
        // Os dois `include` novos (SPEC-040): sem eles a tela precisaria de
        // três requisições para responder uma pergunta só.
        mailDeliveries: { orderBy: { createdAt: 'desc' }, take: 50 },
        events: { orderBy: { createdAt: 'desc' }, take: 100 },
      },
    });
    if (!licenca) throw new NotFoundException('Licença não encontrada');

    const vivas = licenca.activations.filter((a) => a.deactivatedAt === null);

    return {
      ...this.toView(licenca, vivas.length),
      activations: licenca.activations.map((a) => ({
        id: a.id,
        fingerprint: a.fingerprint,
        hostname: a.hostname,
        appVersion: a.appVersion,
        activatedAt: a.activatedAt.toISOString(),
        lastSeenAt: a.lastSeenAt.toISOString(),
        deactivatedAt: a.deactivatedAt ? a.deactivatedAt.toISOString() : null,
      })),
      sourceAccess: licenca.sourceAccess,
      githubUsername: licenca.githubUsername,
      sourceAccessError: licenca.sourceAccessError,
      sourceInviteAt: licenca.sourceInviteAt
        ? licenca.sourceInviteAt.toISOString()
        : null,
      saleRef: licenca.saleRef,
      pastDueAt: licenca.pastDueAt ? licenca.pastDueAt.toISOString() : null,
      mailDeliveries: licenca.mailDeliveries.map((m) => ({
        id: m.id,
        to: m.to,
        template: m.template,
        subject: m.subject,
        status: m.status,
        attempts: m.attempts,
        error: m.error,
        createdAt: m.createdAt.toISOString(),
        sentAt: m.sentAt ? m.sentAt.toISOString() : null,
      })),
      events: licenca.events.map((e) => ({
        id: e.id,
        type: e.type,
        payload: e.payload,
        createdAt: e.createdAt.toISOString(),
      })),
      swapCount: await this.swapCount(licenseId),
      swapWindowDays: SWAP_WINDOW_DAYS,
    };
  }

  /**
   * Trocas na janela: `deactivated` + `reactivated` da trilha.
   *
   * **Derivado de `LicEvent`, sem coluna nova** (§Notas técnicas). Uma coluna
   * de contador precisaria ser alimentada em todo caminho que desativa — e a
   * que alguém esquecesse de incrementar mentiria em silêncio, que é o mesmo
   * problema do `LlmUsage.tenant_id` registrado no `STATUS.md`.
   */
  private async swapCount(licenseId: string): Promise<number> {
    const desde = new Date(Date.now() - SWAP_WINDOW_DAYS * 24 * 60 * 60 * 1000);
    return this.prisma.licEvent.count({
      where: {
        licenseId,
        type: { in: ['deactivated', 'reactivated', 'deactivated_by_admin'] },
        createdAt: { gte: desde },
      },
    });
  }

  /**
   * Desativa uma máquina pelo admin — o suporte manual de quando o
   * self-service não resolve (§Escopo).
   *
   * Mesma semântica do `/deactivate` público, com evento próprio
   * (`deactivated_by_admin`): a trilha precisa distinguir "o cliente trocou de
   * máquina" de "o suporte interveio", porque as duas contam a mesma história
   * para o contador e histórias diferentes para quem lê.
   */
  async deactivateActivation(
    tenantId: string,
    licenseId: string,
    activationId: string,
  ): Promise<ActivationView> {
    const ativacao = await this.prisma.activation.findFirst({
      // `licenseId` e `tenantId` juntos: ativação de outra licença responde o
      // mesmo que inexistente, como no público.
      where: { id: activationId, licenseId, tenantId },
    });
    if (!ativacao) throw new NotFoundException('Ativação não encontrada');

    // Idempotente, e sem evento novo na repetição — evento duplicado inflaria o
    // contador de trocas e faria o sinal de abuso disparar por clique repetido.
    if (ativacao.deactivatedAt === null) {
      await this.prisma.activation.update({
        where: { id: activationId },
        data: { deactivatedAt: new Date() },
      });
      await this.prisma.licEvent.create({
        data: {
          tenantId,
          licenseId,
          type: 'deactivated_by_admin',
          payload: { fingerprint: ativacao.fingerprint },
        },
      });
      this.logger.log(`Ativação ${activationId} desativada pelo admin`);
    }

    const atual = await this.prisma.activation.findUniqueOrThrow({
      where: { id: activationId },
    });
    return {
      id: atual.id,
      fingerprint: atual.fingerprint,
      hostname: atual.hostname,
      appVersion: atual.appVersion,
      activatedAt: atual.activatedAt.toISOString(),
      lastSeenAt: atual.lastSeenAt.toISOString(),
      deactivatedAt: atual.deactivatedAt ? atual.deactivatedAt.toISOString() : null,
    };
  }

  /** Trilha da licença, mais recente primeiro (§Escopo). */
  async events(tenantId: string, licenseId: string): Promise<LicEventView[]> {
    const existe = await this.prisma.license.findFirst({
      where: { id: licenseId, tenantId },
      select: { id: true },
    });
    if (!existe) throw new NotFoundException('Licença não encontrada');

    const eventos = await this.prisma.licEvent.findMany({
      where: { licenseId },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });

    return eventos.map((e) => ({
      id: e.id,
      type: e.type,
      payload: e.payload,
      createdAt: e.createdAt.toISOString(),
    }));
  }

  /**
   * Forma de leitura da licença. **Não tem campo para a chave** — é o tipo, e
   * não a disciplina de quem escreve a query, que impede a chave de vazar por
   * um caminho de leitura novo.
   */
  private toView(
    licenca: {
      id: string;
      status: LicenseStatus;
      customerEmail: string;
      customerName: string | null;
      issuedAt: Date;
      updatesUntil: Date;
      expiresAt: Date | null;
      revokedAt: Date | null;
      revokedReason: string | null;
      edition: {
        slug: string;
        name: string;
        maxMachines: number;
        product: { slug: string };
      };
    },
    activeMachines: number,
  ): LicenseView {
    return {
      id: licenca.id,
      status: licenca.status,
      customerEmail: licenca.customerEmail,
      customerName: licenca.customerName,
      editionSlug: licenca.edition.slug,
      editionName: licenca.edition.name,
      productSlug: licenca.edition.product.slug,
      issuedAt: licenca.issuedAt.toISOString(),
      updatesUntil: licenca.updatesUntil.toISOString(),
      expiresAt: licenca.expiresAt ? licenca.expiresAt.toISOString() : null,
      revokedAt: licenca.revokedAt ? licenca.revokedAt.toISOString() : null,
      revokedReason: licenca.revokedReason,
      activeMachines,
      maxMachines: licenca.edition.maxMachines,
    };
  }
}

/** `unknown` → string aparada. Entrada de rota nunca é confiável de tipo. */
function texto(valor: unknown): string {
  return typeof valor === 'string' ? valor.trim() : '';
}
