import {
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';

/**
 * Admin das releases (SPEC-041 §Escopo item 2) — **registra o ponteiro, não
 * sobe arquivo**.
 *
 * O binário já vive na Release privada do GitHub (ADR-028); aqui se guarda o
 * `assetId` que o `download` troca por URL assinada, mais o `sha256` que a
 * máquina do cliente confere depois de baixar. Nenhum byte passa por esta casa —
 * nem por upload, nem por download.
 *
 * ## Por que registro manual, e não pelo CI do War Room
 *
 * Decisão do PI (§Fora de escopo): publicar pelo CI exigiria um token de máquina
 * com escrita administrativa **dentro do módulo que guarda as licenças** —
 * superfície de autenticação nova, no lugar mais sensível do produto, para
 * economizar um formulário que se preenche uma vez por versão. Gatilho de
 * revisão: passar de ~1 release por semana no piloto.
 */

export interface CreateReleaseInput {
  productId?: unknown;
  version?: unknown;
  os?: unknown;
  releasedAt?: unknown;
  assetId?: unknown;
  sha256?: unknown;
  notes?: unknown;
}

export interface ReleaseView {
  id: string;
  productId: string;
  version: string;
  os: string;
  releasedAt: string;
  assetId: string;
  sha256: string;
  notes: string | null;
  published: boolean;
}

/** 64 dígitos hex — a mesma forma que o CHECK do banco exige. */
const SHA256 = /^[0-9a-f]{64}$/i;
const MAX_VERSION = 64;
const MAX_OS = 32;
const MAX_ASSET_ID = 64;
const MAX_NOTES = 4000;

@Injectable()
export class ReleaseAdminService {
  private readonly logger = new Logger(ReleaseAdminService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** As releases do tenant, mais nova primeiro. Inclui as despublicadas. */
  async list(tenantId: string, productId?: string): Promise<ReleaseView[]> {
    const linhas = await this.prisma.licRelease.findMany({
      where: { tenantId, ...(productId ? { productId } : {}) },
      orderBy: { releasedAt: 'desc' },
    });

    return linhas.map((r) => this.view(r));
  }

  /**
   * Registra uma release.
   *
   * **Toda validação acontece aqui, antes do banco** — e não porque o banco não
   * valide: os CHECKs do PR-1 existem e são a última linha. O ponto é o
   * *desfecho*: uma violação de CHECK sobe como `23514` e vira **`500` na tela**,
   * que diz "o ProPlan quebrou" sobre um erro que é *"você digitou o hash
   * errado"*. Foi exatamente o FIX #216.
   */
  async create(tenantId: string, input: CreateReleaseInput): Promise<ReleaseView> {
    const productId = texto(input.productId);
    const version = texto(input.version).slice(0, MAX_VERSION);
    const os = texto(input.os).slice(0, MAX_OS);
    const assetId = texto(input.assetId).slice(0, MAX_ASSET_ID);
    const sha256 = texto(input.sha256).toLowerCase();
    const notes = texto(input.notes).slice(0, MAX_NOTES) || null;

    if (!productId || !version || !os || !assetId) {
      throw new UnprocessableEntityException(
        '`productId`, `version`, `os` e `assetId` são obrigatórios',
      );
    }

    // **O `sha256` é o campo que mais importa validar, e o motivo é quando ele
    // falha**: o hash só é conferido pela máquina do cliente, DEPOIS de baixar.
    // Um valor malformado gastaria 80 MB de transferência e apareceria como
    // "download corrompido" — mandando o operador caçar problema de rede num
    // erro de digitação.
    if (!SHA256.test(sha256)) {
      throw new UnprocessableEntityException(
        '`sha256` deve ter 64 dígitos hexadecimais',
      );
    }

    const releasedAt = data(input.releasedAt);
    if (!releasedAt) {
      // **Informado, nunca `now()`** (§Contratos): registrar uma release antiga
      // com a data de hoje a tornaria indevidamente autorizada para quem já tem
      // a janela vencida — o oposto exato da promessa da licença perpétua.
      throw new UnprocessableEntityException(
        '`releasedAt` é obrigatório e deve ser uma data válida',
      );
    }

    // O produto tem de ser deste tenant. Sem esta checagem o `create` cairia no
    // FK e responderia `500` — ou, pior, num tenant que por acaso conhecesse o
    // id, penduraria release no produto alheio.
    const produto = await this.prisma.licProduct.findFirst({
      where: { id: productId, tenantId },
      select: { id: true },
    });
    if (!produto) throw new NotFoundException('Produto não encontrado');

    const jaExiste = await this.prisma.licRelease.findFirst({
      where: { productId, version, os },
      select: { id: true },
    });
    if (jaExiste) {
      // O `@@unique` do banco recusaria de todo modo — mas com `P2002`, que a
      // tela mostraria como erro genérico. Nomear o conflito é o que permite ao
      // operador entender que já registrou esta versão.
      throw new UnprocessableEntityException(
        `A versão ${version} (${os}) já está registrada para este produto`,
      );
    }

    const criada = await this.prisma.licRelease.create({
      data: { tenantId, productId, version, os, releasedAt, assetId, sha256, notes },
    });

    this.logger.log(`Tenant ${tenantId}: release ${version} (${os}) registrada`);
    return this.view(criada);
  }

  /**
   * Despublica — some do `check` **e** do `download` (§Critérios de aceite).
   *
   * **Não apaga a linha**, e a diferença importa: a trilha de quem já baixou
   * aponta para esta release, e o artefato continua existindo no GitHub. Apagar
   * quebraria a referência do `LicEvent` sem tirar o binário de circulação — o
   * pior dos dois mundos.
   */
  async unpublish(tenantId: string, id: string): Promise<ReleaseView> {
    const release = await this.prisma.licRelease.findFirst({
      where: { id, tenantId },
      select: { id: true },
    });
    if (!release) throw new NotFoundException('Release não encontrada');

    const atualizada = await this.prisma.licRelease.update({
      where: { id },
      data: { published: false },
    });

    this.logger.log(`Tenant ${tenantId}: release ${atualizada.version} despublicada`);
    return this.view(atualizada);
  }

  /**
   * Republica. Existe porque despublicar por engano é o erro provável de um botão
   * que fica ao lado da lista — e sem volta, o operador teria de registrar a
   * mesma versão de novo, que o `@@unique` recusa.
   */
  async publish(tenantId: string, id: string): Promise<ReleaseView> {
    const release = await this.prisma.licRelease.findFirst({
      where: { id, tenantId },
      select: { id: true },
    });
    if (!release) throw new NotFoundException('Release não encontrada');

    const atualizada = await this.prisma.licRelease.update({
      where: { id },
      data: { published: true },
    });

    this.logger.log(`Tenant ${tenantId}: release ${atualizada.version} republicada`);
    return this.view(atualizada);
  }

  private view(r: {
    id: string;
    productId: string;
    version: string;
    os: string;
    releasedAt: Date;
    assetId: string;
    sha256: string;
    notes: string | null;
    published: boolean;
  }): ReleaseView {
    return {
      id: r.id,
      productId: r.productId,
      version: r.version,
      os: r.os,
      releasedAt: r.releasedAt.toISOString(),
      assetId: r.assetId,
      sha256: r.sha256,
      notes: r.notes,
      published: r.published,
    };
  }
}

/** Normaliza entrada não-confiável: só string vira texto, o resto vira vazio. */
function texto(valor: unknown): string {
  return typeof valor === 'string' ? valor.trim() : '';
}

/** Data válida, ou `null`. Recusa string vazia e `Invalid Date`. */
function data(valor: unknown): Date | null {
  if (typeof valor !== 'string' || !valor.trim()) return null;
  const d = new Date(valor);
  return Number.isNaN(d.getTime()) ? null : d;
}
