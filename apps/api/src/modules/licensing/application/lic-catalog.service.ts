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
  /**
   * Esta edição dá acesso ao repositório de código-fonte? (SPEC-039.)
   *
   * **É o que o `webhook-processor` lê para agendar o convite na compra** — e o
   * que substituiu o hardcode `slug === 'source'`, que quebraria em silêncio no
   * 1º produto que chamasse a edição de outra coisa. Sai na listagem porque sem
   * ver o valor atual não há como corrigi-lo, e o modo de errar é mudo: a venda
   * chega, a licença é emitida sem agendamento, e o comprador da edição mais cara
   * nunca recebe o convite.
   */
  grantsSourceAccess: boolean;
  /** Quantas licenças já saíram desta edição — o que impede apagá-la. */
  licenseCount: number;
}

export interface ProductView {
  id: string;
  slug: string;
  name: string;
  keyPrefix: string;
  /**
   * `owner/name` do repositório de código-fonte, ou `null` (SPEC-039).
   *
   * Sai na listagem porque a tela precisa mostrar o **valor atual** para editá-lo
   * — e porque `null` aqui é a causa de o convite não ter destino, que sem isto o
   * operador só descobriria pelo teste de conexão.
   */
  sourceRepo: string | null;
  /**
   * URL pública de download do instalador, ou `null` (SPEC-042).
   *
   * Sai na listagem pelo mesmo motivo do `sourceRepo`: a tela edita o valor
   * atual, e `null` aqui é a causa de o e-mail da chave sair sem o link — algo
   * que, sem isto, só se descobriria pela reclamação de quem comprou.
   */
  downloadUrl: string | null;
  /** URL pública do manual, ou `null` (SPEC-042). */
  manualUrl: string | null;
  editions: EditionView[];
}

/**
 * Campos editáveis do produto depois de criado (SPEC-042).
 *
 * **Ausente ≠ vazio**, e a distinção é o contrato desta rota: campo ausente não
 * é tocado (a tela salva um campo por vez), string vazia limpa para `null`.
 * Confundir os dois tornaria impossível desconfigurar pela interface — o mesmo
 * defeito que o FIX #214 corrigiu no `grantsSourceAccess`.
 */
export interface UpdateProductInput {
  sourceRepo?: unknown;
  downloadUrl?: unknown;
  manualUrl?: unknown;
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
  /** Ausente = `false`. Ver `EditionView.grantsSourceAccess`. */
  grantsSourceAccess?: unknown;
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

/**
 * `owner/name` do GitHub, exatamente o que a API de colaboradores espera.
 *
 * Recusa URL colada inteira e caminho com barra a mais. As regras de nome do
 * GitHub são mais estritas que isto (sem `--`, sem começar com hífen), mas
 * replicá-las aqui criaria uma segunda fonte da verdade que diverge quando eles
 * mudarem — quem julga o nome é o GitHub, no teste de conexão. O que esta regex
 * pega é o erro de **forma**, que produziria um `404` confuso na hora do convite.
 */
const REPO_RE = /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/;

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
      sourceRepo: p.sourceRepo,
      downloadUrl: p.downloadUrl,
      manualUrl: p.manualUrl,
      editions: p.editions.map((e) => ({
        id: e.id,
        slug: e.slug,
        name: e.name,
        billingModel: e.billingModel,
        maxMachines: e.maxMachines,
        updatesMonths: e.updatesMonths,
        grantsSourceAccess: e.grantsSourceAccess,
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
      return {
        ...produto,
        sourceRepo: produto.sourceRepo,
        downloadUrl: produto.downloadUrl,
        manualUrl: produto.manualUrl,
        editions: [],
      };
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

    // Ausente = `false`, o default do schema. **Nenhuma edição passa a conceder
    // código-fonte por acidente**: é preciso pedir explicitamente.
    const grantsSourceAccess = input.grantsSourceAccess === true;

    try {
      const edicao = await this.prisma.licEdition.create({
        data: {
          productId,
          slug,
          name,
          billingModel,
          maxMachines,
          updatesMonths,
          grantsSourceAccess,
        },
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
  /**
   * Edita os campos configuráveis do produto — `sourceRepo` (FIX #212),
   * `downloadUrl` e `manualUrl` (SPEC-042).
   *
   * **Uma rota para os três, e não uma por coluna.** A `/source-repo` nasceu
   * sozinha porque era a única; repeti-la por campo novo é o caminho que já
   * produziu três achados nesta área (`sourceRepo`, `githubPat`,
   * `grantsSourceAccess`), todos com o mesmo sintoma mudo: coluna no schema,
   * lida pelo backend, sem caminho pela interface.
   *
   * **Ausente não é tocado; string vazia limpa.** A tela salva um campo por vez,
   * então mandar só o que mudou precisa significar "não mexa no resto" — senão o
   * primeiro save apagaria os outros dois. E limpar precisa ser possível pela
   * interface: desconfigurar é ação legítima (o produto deixou de vender
   * código-fonte, o download mudou de casa) e não pode exigir SQL.
   *
   * **Formato validado aqui, e não só no destino.** Para `sourceRepo`, `owner/name`
   * é o que a API do GitHub espera em `PUT /repos/:owner/:repo/collaborators/…`;
   * uma URL colada inteira produziria `404` no convite, que a lista de pendências
   * mostraria como *"repositório não encontrado"* — mandando o operador procurar
   * problema de permissão num erro de digitação. Para as URLs, o destino é o
   * e-mail de um comprador: um valor torto vira link quebrado na caixa de entrada
   * de quem acabou de pagar, e ninguém avisa.
   */
  async updateProduct(
    tenantId: string,
    productId: string,
    input: UpdateProductInput,
  ): Promise<ProductView> {
    const produto = await this.prisma.licProduct.findFirst({
      where: { id: productId, tenantId },
      select: { id: true },
    });
    if (!produto) throw new NotFoundException('Produto não encontrado');

    const data: Prisma.LicProductUpdateInput = {};

    if (input.sourceRepo !== undefined) {
      const valor = ouNulo(input.sourceRepo);
      if (valor !== null && !REPO_RE.test(valor)) {
        throw new UnprocessableEntityException(
          'Repositório no formato `dono/nome` (ex.: RodReis/war-room), sem URL',
        );
      }
      data.sourceRepo = valor;
    }
    if (input.downloadUrl !== undefined) {
      data.downloadUrl = this.urlPublica(input.downloadUrl, 'download');
    }
    if (input.manualUrl !== undefined) {
      data.manualUrl = this.urlPublica(input.manualUrl, 'manual');
    }

    await this.prisma.licProduct.update({ where: { id: productId }, data });

    // Devolve a listagem do produto atualizado — a tela substitui o item inteiro,
    // e montar um `ProductView` parcial aqui duplicaria o mapeamento do `list`.
    const atualizados = await this.listProducts(tenantId);
    return atualizados.find((p) => p.id === productId)!;
  }

  /**
   * Limites da edição e o acesso ao código-fonte (FIX #214).
   *
   * **`grantsSourceAccess` é alterável, ao contrário de `slug` e `billingModel`.**
   * Aqueles dois viajam no license file já emitido ou mudam o significado de
   * `expiresAt` numa licença viva; este só decide o que acontece nas compras
   * **futuras** — o `webhook-processor` o lê no momento da venda, e licença já
   * emitida carrega o próprio `sourceInviteAt`.
   *
   * Sem esta rota a coluna era inalcançável: nasceu no PR-1 da SPEC-039, é lida
   * pelo webhook, e nada a escrevia. O sintoma era mudo — a venda chega, a licença
   * sai sem agendamento, e o comprador da edição mais cara nunca recebe o convite.
   */
  async updateEditionLimits(
    tenantId: string,
    editionId: string,
    input: {
      maxMachines?: unknown;
      updatesMonths?: unknown;
      grantsSourceAccess?: unknown;
    },
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

    // Ausente não é tocado — mesma regra dos limites. `Boolean(...)` e não
    // `=== true` porque aqui o campo **existe** no input: quem manda `false`
    // quer desligar, e tratar isso como "não mexer" tornaria impossível desfazer
    // a marcação pela tela.
    const grantsSourceAccess =
      input.grantsSourceAccess === undefined
        ? edicao.grantsSourceAccess
        : input.grantsSourceAccess === true;

    const atualizada = await this.prisma.licEdition.update({
      where: { id: editionId },
      data: { maxMachines, updatesMonths, grantsSourceAccess },
      include: { _count: { select: { licenses: true } } },
    });

    return {
      id: atualizada.id,
      slug: atualizada.slug,
      name: atualizada.name,
      billingModel: atualizada.billingModel,
      maxMachines: atualizada.maxMachines,
      updatesMonths: atualizada.updatesMonths,
      grantsSourceAccess: atualizada.grantsSourceAccess,
      licenseCount: atualizada._count.licenses,
    };
  }

  /**
   * URL absoluta `https`, ou `null` quando vazia (SPEC-042).
   *
   * **Parse, não regex** — mesmo padrão do `http-probe.ts` da ingestão: `new URL()`
   * é quem sabe o que é uma URL, e uma regex própria seria uma segunda definição
   * que diverge da primeira.
   *
   * **`https` obrigatório.** O valor vai por e-mail para um comprador: `http:`
   * entrega o instalador por canal que qualquer intermediário reescreve, e
   * esquemas como `javascript:` ou `data:` passariam pelo parse — `new URL()` os
   * aceita — enquanto o cliente de e-mail os trata de formas que ninguém aqui
   * controla. O gate é o esquema, não a lista de esquemas ruins: allowlist não
   * envelhece com o esquema novo da próxima década.
   */
  private urlPublica(valor: unknown, rotulo: string): string | null {
    const bruto = ouNulo(valor);
    if (bruto === null) return null;

    let url: URL;
    try {
      url = new URL(bruto);
    } catch {
      throw new UnprocessableEntityException(
        `Link de ${rotulo}: informe o endereço completo, começando com https://`,
      );
    }
    if (url.protocol !== 'https:') {
      throw new UnprocessableEntityException(
        `Link de ${rotulo} precisa ser https://`,
      );
    }
    return bruto;
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

/**
 * `unknown` → string aparada, ou `null` quando vazia.
 *
 * Campo opcional que o operador apagou chega como `''`, e gravar string vazia
 * criaria um segundo jeito de dizer "não configurado" — que toda leitura teria
 * de checar duas vezes, e alguma esqueceria.
 */
function ouNulo(valor: unknown): string | null {
  const bruto = texto(valor);
  return bruto === '' ? null : bruto;
}
