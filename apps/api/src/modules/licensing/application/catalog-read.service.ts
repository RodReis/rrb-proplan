import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import {
  ofertasNuncaVendidas,
  type OfertaDoCatalogo,
} from '../domain/catalog-offers';
import { LicensingOpsService } from './licensing-ops.service';
import { NUNCA_SINCRONIZOU, type CatalogoPayload } from './catalog-sync.service';

/**
 * A leitura do catálogo (SPEC-047, `GET /licensing/admin/kiwify/catalog`).
 *
 * **Nunca chama a Kiwify.** Lê o snapshot e cruza com os mapeamentos na hora —
 * o mesmo princípio da regra de inferência do CLAUDE.md, aplicado a API externa:
 * nenhuma chamada externa no caminho de renderização. A Kiwify só é consultada
 * pelo job ou pelo clique explícito no botão.
 *
 * ## Service separado do `CatalogSyncService`, e a separação é a decisão
 *
 * Aquele **escreve** o retrato e fala HTTP com a plataforma; este **lê** e não
 * conhece a Kiwify. Juntá-los poria o método que dispara N chamadas externas no
 * mesmo objeto que a rota de leitura instancia — a mesma separação que os dois
 * services de relato de erro já fazem (SPEC-043).
 */

/** Uma oferta do catálogo, como a tela a recebe. */
export interface OfertaCatalogo {
  externalProductId: string;
  productName: string;
  /** `null` = o produto não tem ofertas; a linha é o curinga dele. */
  externalOfferId: string | null;
  offerName: string | null;
  /** Mapeamento exato **ou** curinga do produto — derivado, nunca persistido. */
  coberta: boolean;
}

export interface CatalogoKiwify {
  /** Só produtos/ofertas ativos, e só o que **não** sai nos blocos 1 e 2. */
  ofertas: OfertaCatalogo[];
  /** `null` = nunca sincronizou com sucesso. */
  fetchedAt: Date | null;
  /** Legível; o retrato anterior continua ao lado dele. */
  fetchError: string | null;
}

@Injectable()
export class CatalogReadService {
  constructor(
    private readonly prisma: PrismaService,
    // Reusa a lista dos blocos 1 e 2 em vez de reimplementá-la: a invariante
    // *uma oferta, um bloco* (SPEC-046, estendida aqui) depende de os dois lados
    // concordarem sobre o que já foi visto, e duas implementações divergiriam no
    // dia em que uma delas mudasse de filtro.
    private readonly ops: LicensingOpsService,
  ) {}

  async catalogo(tenantId: string): Promise<CatalogoKiwify> {
    const [snapshot, mapeamentos, vistas] = await Promise.all([
      this.prisma.licCatalogSnapshot.findUnique({
        where: { tenantId },
        select: { payload: true, fetchedAt: true, fetchError: true },
      }),
      this.prisma.licOfferMapping.findMany({
        select: { externalProductId: true, externalOfferId: true },
      }),
      this.ops.listSeenOffers(),
    ]);

    // Sem snapshot: **não é erro, é o convite ao botão** (§Escopo). A tela
    // distingue "nunca sincronizou" de "sincronizou e não achou nada", e as duas
    // pedem coisas diferentes do operador.
    if (!snapshot) {
      return { ofertas: [], fetchedAt: null, fetchError: null };
    }

    const doCatalogo = achatar(snapshot.payload);

    const ofertas = ofertasNuncaVendidas(
      doCatalogo,
      mapeamentos,
      vistas.map((v) => ({
        externalProductId: v.externalProductId,
        externalOfferId: v.externalOfferId,
      })),
    );

    return {
      // `coberta` sai sempre `false` porque a função pura **já removeu** as
      // cobertas — o campo existe no contrato para a tela não ter de inferir o
      // significado da ausência, e mantê-lo honesto aqui é mais barato que
      // explicar adiante por que ele é sempre falso.
      ofertas: ofertas.map((o) => ({ ...o, coberta: false })),
      // A época volta a ser `null`: aquela linha existe só para carregar o
      // `fetchError` da primeira tentativa falha, e mostrar "1970" na tela seria
      // pior que não mostrar data (ver `NUNCA_SINCRONIZOU`).
      fetchedAt:
        snapshot.fetchedAt.getTime() === NUNCA_SINCRONIZOU.getTime()
          ? null
          : snapshot.fetchedAt,
      fetchError: snapshot.fetchError,
    };
  }
}

/**
 * O payload do snapshot vira a lista plana que a regra consome.
 *
 * **Produto sem ofertas vira uma linha de curinga** (`externalOfferId: null`) —
 * a doc da Kiwify mostra produto ativo com `offers: []` e preço no próprio
 * produto, e omiti-lo deixaria invisível justamente o produto cuja primeira
 * compra vai falhar (decisão do PI, 2026-08-04).
 *
 * O payload é `Json` do Prisma, então nada aqui pode assumir formato: um
 * snapshot gravado por versão anterior do sync não pode derrubar a aba inteira.
 */
function achatar(payload: unknown): OfertaDoCatalogo[] {
  const produtos = (payload as CatalogoPayload | null)?.produtos;
  if (!Array.isArray(produtos)) return [];

  const linhas: OfertaDoCatalogo[] = [];

  for (const p of produtos) {
    if (!p || typeof p.id !== 'string') continue;
    const productName = typeof p.name === 'string' ? p.name : p.id;
    const offers = Array.isArray(p.offers) ? p.offers : [];

    if (offers.length === 0) {
      linhas.push({
        externalProductId: p.id,
        productName,
        externalOfferId: null,
        offerName: null,
      });
      continue;
    }

    for (const o of offers) {
      if (!o || typeof o.id !== 'string') continue;
      linhas.push({
        externalProductId: p.id,
        productName,
        externalOfferId: o.id,
        offerName: typeof o.name === 'string' ? o.name : o.id,
      });
    }
  }

  return linhas;
}
