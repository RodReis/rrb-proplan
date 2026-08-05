import { ConflictException, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { CryptoService } from '../../identity/infrastructure/crypto.service';
import { PLATFORM_KIWIFY } from '../licensing.constants';
import {
  KiwifyCatalogClient,
  type KiwifyProduct,
} from '../infrastructure/kiwify-catalog.client';
import { kiwifyConfigurado } from './licensing-ops.service';

/**
 * Carimbo de *"ainda não houve retrato bom"*.
 *
 * A época, e não `null`, porque a coluna é `NOT NULL` — um retrato de verdade
 * sempre tem data. Quem traduz de volta para `fetchedAt: null` (§Contratos) é a
 * leitura, e a constante existe para que os dois lados comparem o mesmo valor:
 * um `new Date(0)` solto de cada lado é o tipo de coincidência que sobrevive até
 * alguém mudar um deles.
 */
export const NUNCA_SINCRONIZOU = new Date(0);

/** O payload gravado no snapshot — o formato deles, normalizado o mínimo. */
export interface CatalogoPayload {
  produtos: Array<{
    id: string;
    name: string;
    offers: Array<{ id: string; name: string }>;
  }>;
}

/**
 * O sync do catálogo da plataforma (SPEC-047).
 *
 * **Um único fluxo, dois gatilhos.** O job diário (ADR-029) e o botão *Buscar
 * ofertas da Kiwify* chamam o **mesmo** método e gravam o **mesmo** snapshot — a
 * spec exige isso, e o motivo é que dois caminhos divergentes produziriam
 * retratos diferentes conforme quem os buscou, com o operador sem nenhuma pista
 * de qual acreditar.
 *
 * ## O que este service NÃO faz
 *
 * Não cruza com `LicOfferMapping`, não decide se uma oferta está coberta, não
 * grava conclusão. Ele guarda **o que a Kiwify disse**, com carimbo. O
 * cruzamento é derivação de leitura, na função pura de `domain/catalog-offers.ts`
 * — a distinção que as SPEC-045/046 policiam, e que aqui é o que permite mapear
 * uma oferta e vê-la sumir da lista **sem novo fetch**.
 */
@Injectable()
export class CatalogSyncService {
  private readonly logger = new Logger(CatalogSyncService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly kiwify: KiwifyCatalogClient,
  ) {}

  /**
   * Os tenants com as três credenciais configuradas — a lista que o job varre.
   *
   * **A única leitura desta fatia que atravessa tenants**, e ela devolve só ids.
   * A pergunta é justamente *"quais tenants?"*; o `runInTenantContext` entra
   * depois, uma vez por tenant, para tudo o que lê ou escreve dado.
   */
  async tenantsConfigurados(): Promise<string[]> {
    const linhas = await this.prisma.licSettings.findMany({
      where: {
        kiwifyClientId: { not: null },
        kiwifyClientSecret: { not: null },
        kiwifyAccountId: { not: null },
      },
      select: { tenantId: true },
    });
    return linhas.map((l) => l.tenantId);
  }

  /**
   * Busca o catálogo e grava o snapshot. **Nunca lança por falha da Kiwify.**
   *
   * A falha vira `fetchError` no snapshot, com o `payload` anterior preservado e
   * o `fetchedAt` antigo dizendo a idade. Lançar aqui faria o job de um tenant
   * derrubar a rodada dos outros — e, no caminho do botão, trocaria uma mensagem
   * acionável ("credencial inválida") por um `500` que diz "o ProPlan quebrou"
   * sobre um problema que é da configuração.
   */
  async sincronizar(tenantId: string): Promise<{ ok: boolean; erro: string | null }> {
    const cred = await this.credenciais(tenantId);
    if (!cred) {
      // Sem credenciais o tenant é **pulado em silêncio** (§Escopo): não é erro,
      // é a configuração ausente. Gravar `fetchError` aqui encheria a tela de
      // vermelho para quem nunca pediu esta funcionalidade.
      return { ok: false, erro: null };
    }

    try {
      const { accessToken } = await this.kiwify.token(cred);
      const produtos = await this.kiwify.catalogo(cred, accessToken);
      await this.gravar(tenantId, produtos);
      this.logger.log(
        `Tenant ${tenantId}: catálogo sincronizado — ${produtos.length} produto(s) ativo(s)`,
      );
      return { ok: true, erro: null };
    } catch (erro) {
      const motivo = erro instanceof Error ? erro.message : String(erro);
      await this.registrarFalha(tenantId, motivo);
      // `warn` e não `error`: credencial trocada na Kiwify é operação normal do
      // dono, e o lugar de contar isso é a tela — que mostra o motivo com a
      // idade do último retrato bom.
      this.logger.warn(`Tenant ${tenantId}: falha ao sincronizar catálogo — ${motivo}`);
      return { ok: false, erro: motivo };
    }
  }

  /**
   * O mesmo fluxo, pelo botão — com o `409` que a rota promete.
   *
   * A tela desabilita o botão sem credenciais, mas **a rota não pode depender
   * disso** (§Contratos): quem chama a API direto merece a mesma recusa
   * explícita, em vez de um "ok" que não sincronizou nada.
   */
  async sincronizarAgora(tenantId: string): Promise<void> {
    const cred = await this.credenciais(tenantId);
    if (!cred) {
      throw new ConflictException(
        'Credenciais da API da Kiwify não configuradas — configure em Licenciamento → Configurações',
      );
    }
    await this.sincronizar(tenantId);
  }

  /**
   * As credenciais em claro, ou `null` se as três não estiverem lá.
   *
   * O secret sai **decifrado daqui e de nenhum outro lugar** — o client recebe
   * em claro como argumento e não o registra em log, mesmo padrão do
   * `GithubSourceClient` com o PAT.
   */
  private async credenciais(tenantId: string) {
    const linha = await this.prisma.licSettings.findUnique({
      where: { tenantId },
      select: {
        kiwifyClientId: true,
        kiwifyClientSecret: true,
        kiwifyAccountId: true,
      },
    });

    if (!linha || !kiwifyConfigurado(linha)) return null;

    return {
      clientId: linha.kiwifyClientId!,
      clientSecret: this.crypto.decrypt(linha.kiwifyClientSecret!),
      accountId: linha.kiwifyAccountId!,
    };
  }

  /** O retrato bom: sobrescreve payload, carimbo e **limpa** o erro anterior. */
  private async gravar(tenantId: string, produtos: KiwifyProduct[]): Promise<void> {
    const payload: CatalogoPayload = {
      produtos: produtos.map((p) => ({
        id: p.id,
        name: p.name,
        offers: p.offers.map((o) => ({ id: o.id, name: o.name })),
      })),
    };

    const dados = {
      platform: PLATFORM_KIWIFY,
      payload: payload as unknown as object,
      fetchedAt: new Date(),
      // Limpo aqui, e só aqui: o erro descrevia a tentativa anterior, e mantê-lo
      // ao lado de um retrato novo faria a tela avisar de um problema resolvido.
      fetchError: null,
    };

    await this.prisma.licCatalogSnapshot.upsert({
      where: { tenantId },
      update: dados,
      create: { tenantId, ...dados },
    });
  }

  /**
   * A falha: grava o motivo **sem tocar no `payload` nem no `fetchedAt`**.
   *
   * É o ponto que a spec trata como critério de aceite. Zerar a lista porque a
   * Kiwify caiu faria a aba afirmar *"não falta de-para nenhum"* — mentira
   * tranquilizadora. O retrato velho com idade visível diz a verdade: *"isto é o
   * que sabíamos às 3h de ontem, e a última tentativa falhou assim"*.
   */
  private async registrarFalha(tenantId: string, motivo: string): Promise<void> {
    const existente = await this.prisma.licCatalogSnapshot.findUnique({
      where: { tenantId },
      select: { id: true },
    });

    if (existente) {
      await this.prisma.licCatalogSnapshot.update({
        where: { tenantId },
        data: { fetchError: motivo },
      });
      return;
    }

    // Primeira tentativa do tenant, e ela falhou: nasce sem produtos, com o
    // motivo. A tela precisa do erro para dizer o que houve — sem esta linha, um
    // tenant com credencial errada veria "nunca sincronizou", que manda o
    // operador clicar de novo em vez de conferir a credencial.
    await this.prisma.licCatalogSnapshot.create({
      data: {
        tenantId,
        platform: PLATFORM_KIWIFY,
        payload: { produtos: [] } as unknown as object,
        fetchedAt: NUNCA_SINCRONIZOU,
        fetchError: motivo,
      },
    });
  }
}
