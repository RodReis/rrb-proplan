import {
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { CryptoService } from '../../identity/infrastructure/crypto.service';
import {
  GithubSourceClient,
  GithubSourceError,
  type GithubAsset,
} from '../infrastructure/github-source.client';

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

/**
 * O que a correção aceita (FIX #242) — o **ponteiro**, nunca a identidade.
 *
 * `version`, `os` e `productId` estão fora de propósito: são o `@@unique` da
 * linha, e a trilha de download aponta para ela. Campo ausente não é tocado.
 */
export interface UpdateReleaseInput {
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
  /**
   * O que a conferência contra o GitHub disse — presente só na resposta de
   * quem **acabou de gravar** (`create`/`update`), nunca no `list`.
   *
   * A razão de não estar no `list` é que ele responderia com o estado de uma
   * conferência que não aconteceu naquele momento: para valer, cada linha
   * exigiria uma ida ao GitHub por render de tela. O `list` diz o que está
   * gravado; a conferência é do ato de gravar.
   */
  asset?: AssetCheck;
}

/**
 * Resultado da conferência do asset. **`checked: false` não é falha** — é
 * "não deu para saber" (sem PAT, sem `sourceRepo`, rede fora). O que é falha
 * lança `422` e nunca chega aqui.
 */
export type AssetCheck =
  | { checked: true; name: string; size: number }
  | { checked: false; reason: string };

/** 64 dígitos hex — a mesma forma que o CHECK do banco exige. */
const SHA256 = /^[0-9a-f]{64}$/i;
const MAX_VERSION = 64;
const MAX_OS = 32;
const MAX_ASSET_ID = 64;
const MAX_NOTES = 4000;

@Injectable()
export class ReleaseAdminService {
  private readonly logger = new Logger(ReleaseAdminService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly github: GithubSourceClient,
    private readonly crypto: CryptoService,
  ) {}

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

    const asset = await this.conferirAsset(tenantId, productId, assetId, sha256);

    const criada = await this.prisma.licRelease.create({
      data: { tenantId, productId, version, os, releasedAt, assetId, sha256, notes },
    });

    this.logger.log(`Tenant ${tenantId}: release ${version} (${os}) registrada`);
    return this.view(criada, asset);
  }

  /**
   * Corrige uma release já registrada (FIX #242).
   *
   * ## Por que precisou existir
   *
   * A `1.0.1` do War Room nasceu com o `assetId` truncado e **não havia caminho
   * para consertar**: não existia edição, e recadastrar esbarra no
   * `@@unique(productId, version, os)` — `unpublish` muda `published`, mas a
   * linha continua ocupando a chave. Despublicar, a tentativa natural de
   * contorno, só piorava: tirava a versão do cliente sem liberar o recadastro.
   * A correção saiu por `UPDATE` no Postgres de produção, contra o que a
   * SPEC-040 §14 define para esta área — *"onde o operador resolve o caso de um
   * cliente sem abrir o banco"*.
   *
   * ## O que NÃO se edita, e por quê
   *
   * `version`, `os` e `productId` são a **identidade** da linha (é o que o
   * `@@unique` diz), e a trilha de download (`LicEvent`) aponta para ela.
   * Trocá-los faria a linha passar a descrever outra coisa, com downloads
   * antigos pendurados no registro errado — destruindo justamente o que a
   * tabela existe para provar. Quem errou a versão registra outra e despublica
   * esta; quem errou o ponteiro corrige aqui.
   *
   * ## Ausente ≠ vazio
   *
   * Campo que não veio no corpo **não é tocado**; `notes: ''` limpa. Confundir
   * os dois tornaria impossível apagar uma nota — ou apagaria tudo a cada
   * edição de um campo só.
   */
  async update(tenantId: string, id: string, input: UpdateReleaseInput): Promise<ReleaseView> {
    const atual = await this.prisma.licRelease.findFirst({
      where: { id, tenantId },
      select: { id: true, productId: true, assetId: true, sha256: true },
    });
    if (!atual) throw new NotFoundException('Release não encontrada');

    const campos: {
      assetId?: string;
      sha256?: string;
      releasedAt?: Date;
      notes?: string | null;
    } = {};

    if (input.assetId !== undefined) {
      const assetId = texto(input.assetId).slice(0, MAX_ASSET_ID);
      if (!assetId) {
        // Vazio aqui não é "limpar": uma release sem ponteiro some do `download`
        // sem sair do `check` — o cliente veria a versão e não a baixaria. É o
        // FIX #242 de novo, por outro caminho.
        throw new UnprocessableEntityException('`assetId` não pode ficar vazio');
      }
      campos.assetId = assetId;
    }

    if (input.sha256 !== undefined) {
      const sha256 = texto(input.sha256).toLowerCase();
      if (!SHA256.test(sha256)) {
        throw new UnprocessableEntityException('`sha256` deve ter 64 dígitos hexadecimais');
      }
      campos.sha256 = sha256;
    }

    if (input.releasedAt !== undefined) {
      const releasedAt = data(input.releasedAt);
      if (!releasedAt) {
        throw new UnprocessableEntityException('`releasedAt` deve ser uma data válida');
      }
      campos.releasedAt = releasedAt;
    }

    if (input.notes !== undefined) {
      // Aqui vazio **é** limpar: nota em branco é estado legítimo, e exigir SQL
      // para apagar um comentário seria o mesmo defeito em miniatura.
      campos.notes = texto(input.notes).slice(0, MAX_NOTES) || null;
    }

    if (Object.keys(campos).length === 0) {
      throw new UnprocessableEntityException('nada para alterar');
    }

    // Confere com os valores que vão VALER depois da edição, não com os que
    // vieram no corpo: editar só o `assetId` tem de conferir contra o `sha256`
    // já gravado, senão a troca de um deles passaria sem comparação nenhuma.
    const asset = await this.conferirAsset(
      tenantId,
      atual.productId,
      campos.assetId ?? atual.assetId,
      campos.sha256 ?? atual.sha256,
    );

    const atualizada = await this.prisma.licRelease.update({ where: { id }, data: campos });

    this.logger.log(
      `Tenant ${tenantId}: release ${atualizada.version} (${atualizada.os}) corrigida ` +
        `(${Object.keys(campos).join(', ')})`,
    );
    return this.view(atualizada, asset);
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

  /**
   * Confere o `assetId` (e o `sha256`) contra o GitHub **antes de gravar**.
   *
   * ## Por que isto existe
   *
   * O FIX #242: a `1.0.1` do War Room foi registrada com `assetId` truncado
   * (`e234138` em vez de `497099385`). **Nada quebrou no cadastro** — o `check`
   * respondeu normalmente, porque só lê `version` e `releasedAt`, e a versão
   * apareceu publicada e correta na tela. O erro só apareceria no `download` da
   * máquina de um cliente, como `404` do GitHub, **depois** de a autorização ter
   * passado. Conferir aqui é a diferença entre o operador ler *"esse asset não
   * existe"* agora e o comprador reportar "não consigo atualizar" dias depois.
   *
   * ## Sem PAT, grava assim mesmo (decisão do PI, 2026-07-31)
   *
   * Recusar seria um bloqueio novo do mesmo tipo que o FIX #212 removeu (o PAT
   * exigindo segredo de webhook): trancaria quem monta o catálogo antes de
   * configurar o source — ordem legítima, já que produto e edição existem antes
   * de haver repositório. Então a falta de PAT devolve `checked: false`, e a
   * tela diz que o asset não foi conferido em vez de afirmar que está certo.
   *
   * O mesmo vale para **rede fora** e para o produto **sem `sourceRepo`**: são
   * situações em que não se sabe, e "não sei" não pode virar "está errado". Só o
   * `404` — que é o GitHub afirmando não encontrar — recusa o cadastro.
   */
  private async conferirAsset(
    tenantId: string,
    productId: string,
    assetId: string,
    sha256: string,
  ): Promise<AssetCheck> {
    const produto = await this.prisma.licProduct.findFirst({
      where: { id: productId, tenantId },
      select: { sourceRepo: true },
    });
    if (!produto?.sourceRepo) {
      return { checked: false, reason: 'produto sem repositório de código-fonte configurado' };
    }

    const settings = await this.prisma.licSettings.findUnique({
      where: { tenantId },
      select: { githubPat: true },
    });
    if (!settings?.githubPat) {
      return { checked: false, reason: 'PAT do GitHub não configurado' };
    }

    let pat: string;
    try {
      pat = this.crypto.decrypt(settings.githubPat);
    } catch {
      // O log não ecoa o valor. Mesma razão do `testConnection` da SPEC-039.
      this.logger.error(`Tenant ${tenantId}: PAT de source ilegível ao conferir asset`);
      return { checked: false, reason: 'PAT ilegível — grave o token de novo' };
    }

    let asset: GithubAsset | null;
    try {
      asset = await this.github.getAsset(pat, produto.sourceRepo, assetId);
    } catch (erro) {
      // `401`/`403`/rede: **não se sabe**. Recusar aqui diria que o `assetId`
      // está errado quando o problema é o token ou a rede — e o operador
      // trocaria um id correto.
      const motivo =
        erro instanceof GithubSourceError ? erro.message : 'não foi possível falar com o GitHub';
      this.logger.warn(`Tenant ${tenantId}: asset não conferido — ${motivo}`);
      return { checked: false, reason: motivo };
    }

    if (!asset) {
      // `404` é o GitHub afirmando que não encontra. **Este é o único desfecho
      // que recusa** — e é exatamente o do FIX #242.
      throw new UnprocessableEntityException(
        `asset ${assetId} não existe na Release do GitHub em ${produto.sourceRepo} ` +
          `(ou está fora do alcance do PAT) — confira o id na página da Release`,
      );
    }

    if (asset.sha256 && asset.sha256 !== sha256) {
      // O sha errado falha na conferência de integridade da máquina do cliente,
      // e lá parece **adulteração de binário** — não erro de digitação.
      throw new UnprocessableEntityException(
        `o \`sha256\` informado não bate com o do asset ${asset.name} no GitHub`,
      );
    }

    return { checked: true, name: asset.name, size: asset.size };
  }

  private view(
    r: {
      id: string;
      productId: string;
      version: string;
      os: string;
      releasedAt: Date;
      assetId: string;
      sha256: string;
      notes: string | null;
      published: boolean;
    },
    asset?: AssetCheck,
  ): ReleaseView {
    return {
      ...(asset ? { asset } : {}),
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
