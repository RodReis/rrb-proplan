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

  /** Licenças do tenant, mais recentes primeiro. Nunca devolve a chave. */
  async list(tenantId: string, email?: string): Promise<LicenseView[]> {
    const filtro = texto(email).toLowerCase();
    const licencas = await this.prisma.license.findMany({
      where: {
        tenantId,
        ...(filtro ? { customerEmail: { contains: filtro } } : {}),
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
