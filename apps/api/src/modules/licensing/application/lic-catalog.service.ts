import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma, type LicBillingModel } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';

/**
 * Produtos e edições licenciáveis do tenant — o CRUD mínimo (SPEC-036 §Escopo).
 *
 * O seed cria o piloto (`warroom` com `closed`/`source`), mas um tenant que
 * chega depois não é atendido por seed nenhum: sem estas rotas ele veria uma
 * tela de emissão sem nada para escolher. Decisão do PI (2026-07-29): seed
 * **e** CRUD mínimo, nesta fatia.
 *
 * **Mínimo é literal.** Criar produto, criar edição, ajustar os limites da
 * edição, listar. Não há remoção: apagar um produto ou uma edição com licença
 * vendida é o que o `ON DELETE RESTRICT` do PR-1 já recusa, e oferecer o botão
 * para depois recusá-lo seria pior do que não oferecer. O painel completo é a
 * SPEC-040.
 */

export interface EditionView {
  id: string;
  slug: string;
  name: string;
  billingModel: LicBillingModel;
  maxMachines: number;
  updatesMonths: number;
  /** Quantas licenças já saíram desta edição — o que impede apagá-la. */
  licenseCount: number;
}

export interface ProductView {
  id: string;
  slug: string;
  name: string;
  keyPrefix: string;
  editions: EditionView[];
}

export interface CreateProductInput {
  slug?: unknown;
  name?: unknown;
  keyPrefix?: unknown;
}

export interface CreateEditionInput {
  slug?: unknown;
  name?: unknown;
  billingModel?: unknown;
  maxMachines?: unknown;
  updatesMonths?: unknown;
}

/**
 * Slug: minúsculas, dígitos e hífen. Ele identifica a edição **dentro do
 * license file** (`payload.edition`), que o cliente do War Room lê — então é
 * parte do contrato público (MVP4 §5), não um rótulo de tela.
 */
const SLUG_RE = /^[a-z0-9-]{1,32}$/;

/**
 * Prefixo da chave: 2 a 6 letras maiúsculas. Curto porque é digitado junto com
 * a chave; só letras porque conviver com dígitos no prefixo tornaria a
 * fronteira `WR-` ambígua para quem lê.
 */
const PREFIXO_RE = /^[A-Z]{2,6}$/;

const MAX_MACHINES_TETO = 100;
const MAX_UPDATES_MESES = 120;

@Injectable()
export class LicCatalogService {
  constructor(private readonly prisma: PrismaService) {}

  async listProducts(tenantId: string): Promise<ProductView[]> {
    const produtos = await this.prisma.licProduct.findMany({
      where: { tenantId },
      include: {
        editions: {
          orderBy: { slug: 'asc' },
          include: { _count: { select: { licenses: true } } },
        },
      },
      orderBy: { slug: 'asc' },
    });

    return produtos.map((p) => ({
      id: p.id,
      slug: p.slug,
      name: p.name,
      keyPrefix: p.keyPrefix,
      editions: p.editions.map((e) => ({
        id: e.id,
        slug: e.slug,
        name: e.name,
        billingModel: e.billingModel,
        maxMachines: e.maxMachines,
        updatesMonths: e.updatesMonths,
        licenseCount: e._count.licenses,
      })),
    }));
  }

  async createProduct(
    tenantId: string,
    input: CreateProductInput,
  ): Promise<ProductView> {
    const slug = texto(input.slug).toLowerCase();
    const name = texto(input.name);
    const keyPrefix = texto(input.keyPrefix).toUpperCase();

    if (!SLUG_RE.test(slug)) {
      throw new UnprocessableEntityException(
        'Identificador do produto: minúsculas, números e hífen',
      );
    }
    if (!name) {
      throw new UnprocessableEntityException('Informe o nome do produto');
    }
    if (!PREFIXO_RE.test(keyPrefix)) {
      throw new UnprocessableEntityException(
        'Prefixo da chave: 2 a 6 letras (ex.: WR)',
      );
    }

    try {
      const produto = await this.prisma.licProduct.create({
        data: { tenantId, slug, name, keyPrefix },
      });
      return { ...produto, editions: [] };
    } catch (erro) {
      // O unique `(tenant_id, slug)` é quem decide, não uma consulta prévia:
      // duas criações simultâneas passariam as duas por um `findFirst`.
      if (
        erro instanceof Prisma.PrismaClientKnownRequestError &&
        erro.code === 'P2002'
      ) {
        throw new ConflictException(`Já existe um produto "${slug}"`);
      }
      throw erro;
    }
  }

  async createEdition(
    tenantId: string,
    productId: string,
    input: CreateEditionInput,
  ): Promise<EditionView> {
    const produto = await this.prisma.licProduct.findFirst({
      where: { id: productId, tenantId },
      select: { id: true },
    });
    if (!produto) throw new NotFoundException('Produto não encontrado');

    const slug = texto(input.slug).toLowerCase();
    const name = texto(input.name);
    if (!SLUG_RE.test(slug)) {
      throw new UnprocessableEntityException(
        'Identificador da edição: minúsculas, números e hífen',
      );
    }
    if (!name) {
      throw new UnprocessableEntityException('Informe o nome da edição');
    }

    const billingModel = this.billingModel(input.billingModel);
    const maxMachines = this.inteiro(input.maxMachines, 2, MAX_MACHINES_TETO, 'máquinas');
    const updatesMonths = this.inteiro(
      input.updatesMonths,
      12,
      MAX_UPDATES_MESES,
      'meses de updates',
    );

    try {
      const edicao = await this.prisma.licEdition.create({
        data: { productId, slug, name, billingModel, maxMachines, updatesMonths },
      });
      return { ...edicao, licenseCount: 0 };
    } catch (erro) {
      if (
        erro instanceof Prisma.PrismaClientKnownRequestError &&
        erro.code === 'P2002'
      ) {
        throw new ConflictException(`Já existe uma edição "${slug}" neste produto`);
      }
      throw erro;
    }
  }

  /**
   * Ajusta os limites comerciais da edição (§Perguntas 1: "ajustável por edição
   * pelo admin").
   *
   * **Só afeta emissões futuras.** `updatesUntil` é copiado para a licença no
   * ato da emissão (PR-1, §Contratos), então mexer aqui não encurta nem estende
   * a janela de quem já comprou — que é exatamente o motivo de ser cópia e não
   * FK. `maxMachines`, ao contrário, é lido a cada ativação: aumentar libera
   * vaga para licenças existentes, e diminuir **não** desativa máquina nenhuma
   * (as que passaram do novo limite continuam ativas até desativação explícita
   * na SPEC-037).
   *
   * `slug` e `billingModel` não são alteráveis: o primeiro viaja no license
   * file já emitido, o segundo muda o significado de `expiresAt` numa licença
   * viva. Trocar qualquer um dos dois é criar edição nova.
   */
  async updateEditionLimits(
    tenantId: string,
    editionId: string,
    input: { maxMachines?: unknown; updatesMonths?: unknown },
  ): Promise<EditionView> {
    const edicao = await this.prisma.licEdition.findFirst({
      where: { id: editionId, product: { tenantId } },
    });
    if (!edicao) throw new NotFoundException('Edição não encontrada');

    const maxMachines =
      input.maxMachines === undefined
        ? edicao.maxMachines
        : this.inteiro(input.maxMachines, edicao.maxMachines, MAX_MACHINES_TETO, 'máquinas');
    const updatesMonths =
      input.updatesMonths === undefined
        ? edicao.updatesMonths
        : this.inteiro(
            input.updatesMonths,
            edicao.updatesMonths,
            MAX_UPDATES_MESES,
            'meses de updates',
          );

    const atualizada = await this.prisma.licEdition.update({
      where: { id: editionId },
      data: { maxMachines, updatesMonths },
      include: { _count: { select: { licenses: true } } },
    });

    return {
      id: atualizada.id,
      slug: atualizada.slug,
      name: atualizada.name,
      billingModel: atualizada.billingModel,
      maxMachines: atualizada.maxMachines,
      updatesMonths: atualizada.updatesMonths,
      licenseCount: atualizada._count.licenses,
    };
  }

  private billingModel(valor: unknown): LicBillingModel {
    if (valor === undefined || valor === null || valor === '') return 'PERPETUAL';
    if (valor === 'PERPETUAL' || valor === 'SUBSCRIPTION') return valor;
    throw new UnprocessableEntityException(
      'Modelo comercial deve ser PERPETUAL ou SUBSCRIPTION',
    );
  }

  /**
   * Inteiro positivo com teto. O teto não é burocracia: `maxMachines` sem
   * limite transforma uma licença em licença de site por digitação errada, e
   * `updatesMonths` absurdo produz uma janela que ninguém pretendeu vender.
   */
  private inteiro(
    valor: unknown,
    padrao: number,
    teto: number,
    rotulo: string,
  ): number {
    if (valor === undefined || valor === null || valor === '') return padrao;
    const n = Number(valor);
    if (!Number.isInteger(n) || n < 1 || n > teto) {
      throw new UnprocessableEntityException(
        `Número de ${rotulo} deve ser inteiro entre 1 e ${teto}`,
      );
    }
    return n;
  }
}

/** `unknown` → string aparada. Entrada de rota nunca é confiável de tipo. */
function texto(valor: unknown): string {
  return typeof valor === 'string' ? valor.trim() : '';
}
