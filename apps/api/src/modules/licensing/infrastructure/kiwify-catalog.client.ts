import { Injectable, Logger } from '@nestjs/common';

const BASE = 'https://public-api.kiwify.com/v1';
const TIMEOUT_MS = 10_000;

/**
 * Margem subtraída do `expires_in` antes de cachear o token.
 *
 * Um token que expira **durante** a rodada produz `401` no meio do N+1, e o
 * retrato sai pela metade. Cinco minutos cobrem a rodada inteira do piloto com
 * folga larga.
 */
const MARGEM_EXPIRACAO_S = 300;

/** As credenciais de um tenant, já em claro (o secret é decifrado pelo service). */
export interface KiwifyCredenciais {
  clientId: string;
  clientSecret: string;
  accountId: string;
}

/** Uma oferta como a Kiwify a descreve. */
export interface KiwifyOffer {
  id: string;
  name: string;
}

/** Um produto do catálogo, com as ofertas do detalhe. */
export interface KiwifyProduct {
  id: string;
  name: string;
  status: string;
  offers: KiwifyOffer[];
}

/**
 * O token e quando ele morre — o cache vive no service, não aqui.
 *
 * Este cliente não conhece Redis de propósito: ele fala HTTP com a Kiwify e
 * nada mais. Quem decide onde guardar o token é quem tem o `tenantId`.
 */
export interface KiwifyToken {
  accessToken: string;
  /** Segundos até expirar, **já com a margem descontada**. */
  ttlSegundos: number;
}

/**
 * A API pública da Kiwify vista pelo caminho do catálogo (SPEC-047).
 *
 * ## Por que um cliente próprio, atrás de interface
 *
 * `platform` continua TEXT e a fronteira do adapter é o que abre Hotmart/Lemon
 * sem migration (SPEC-038, mantida). O que este arquivo isola é **o formato
 * deles**: nomes de campo, paginação, o header `x-kiwify-account-id`, o OAuth em
 * `form-urlencoded`. Nada disso vaza para o `application/`, que fala em
 * produto/oferta e não em `page_number`.
 *
 * Fetch nativo, como toda a integração GitHub — Octokit é ESM-only e conflita
 * com o build CJS do Nest (CLAUDE.md §Stack).
 *
 * ## As credenciais nunca entram em log
 *
 * Nem em caso de erro. Um `401` que ecoasse o corpo do pedido entregaria o
 * `client_secret` a quem lê log — e ele dá leitura do catálogo comercial
 * inteiro. O que se registra é o **status** e o que se pode fazer a respeito.
 *
 * ## O N+1 é assumido (§Notas técnicas da spec)
 *
 * `offers[]` só vem no detalhe do produto, então são 1 + N chamadas. Com rate
 * limit de 100/min o teto prático é ~99 produtos por rodada — ordens de
 * grandeza acima do catálogo do piloto.
 */
@Injectable()
export class KiwifyCatalogClient {
  private readonly logger = new Logger(KiwifyCatalogClient.name);

  /**
   * Troca as credenciais por um token.
   *
   * **O TTL vem da resposta, nunca hardcode.** A doc da Kiwify se contradiz — o
   * texto fala em 96h, o exemplo devolve `expires_in: 86400` (24h) — e ela
   * própria pede para não gerar token por chamada. Confiar no texto produziria
   * `401` no meio da rodada; confiar na resposta é o que sobrevive a eles
   * mudarem de ideia.
   *
   * `form-urlencoded`, não JSON: é o que o endpoint aceita.
   */
  async token(cred: KiwifyCredenciais): Promise<KiwifyToken> {
    const res = await this.req(`${BASE}/oauth/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: cred.clientId,
        client_secret: cred.clientSecret,
      }).toString(),
    });

    if (!res.ok) {
      // O corpo do erro traz `message` legível ("Invalid client: client is
      // invalid"), acionável para quem configurou. O corpo do **pedido** é que
      // nunca sai.
      const motivo = await this.motivo(res);
      this.logger.warn(`OAuth da Kiwify respondeu ${res.status}`);
      throw new Error(`Kiwify recusou as credenciais (${res.status}): ${motivo}`);
    }

    const body = (await res.json()) as { access_token?: string; expires_in?: number };
    if (!body.access_token) {
      throw new Error('Kiwify devolveu token vazio');
    }

    // Sem `expires_in` na resposta, 1h: curto o bastante para não guardar um
    // token morto por um dia, longo o bastante para não gerar um por chamada —
    // que é o que a doc deles pede para evitar.
    const bruto = typeof body.expires_in === 'number' ? body.expires_in : 3600;

    return {
      accessToken: body.access_token,
      // `max(60)` porque um `expires_in` menor que a margem produziria TTL
      // negativo, e TTL negativo apaga a chave na hora — voltando ao token por
      // chamada, em silêncio.
      ttlSegundos: Math.max(60, bruto - MARGEM_EXPIRACAO_S),
    };
  }

  /**
   * O catálogo: produtos **ativos** com as ofertas de cada um.
   *
   * A filtragem por `status` acontece aqui, e não no domínio, porque é o formato
   * deles: quem lê o snapshot adiante não deveria precisar saber que a string
   * `'active'` é o que significa vendável na Kiwify.
   *
   * **Oferta inativa é descartada; produto sem ofertas é preservado.** Um
   * produto ativo pode vender com o preço nele mesmo e `offers: []` — a doc
   * oficial mostra exatamente esse caso —, e descartá-lo deixaria invisível
   * justamente o produto cuja primeira compra vai falhar. Ele vira linha de
   * curinga adiante (decisão do PI, 2026-08-04).
   */
  async catalogo(cred: KiwifyCredenciais, accessToken: string): Promise<KiwifyProduct[]> {
    const produtos = await this.listarProdutos(cred, accessToken);

    const ativos = produtos.filter((p) => p.status === 'active');
    const detalhados: KiwifyProduct[] = [];

    // Sequencial, não `Promise.all`: 100 req/min é o limite deles, e disparar N
    // detalhes de uma vez é o jeito mais rápido de tomar `429` num catálogo que
    // cresceu. O piloto tem 1 produto; a lentidão é teórica, o `429` não seria.
    for (const p of ativos) {
      const detalhe = await this.detalharProduto(cred, accessToken, p.id);
      if (detalhe) detalhados.push(detalhe);
    }

    return detalhados;
  }

  private async listarProdutos(
    cred: KiwifyCredenciais,
    accessToken: string,
  ): Promise<Array<{ id: string; name: string; status: string }>> {
    const res = await this.req(`${BASE}/products?page_size=100&page_number=1`, {
      headers: this.headers(cred, accessToken),
    });

    if (!res.ok) {
      const motivo = await this.motivo(res);
      throw new Error(`Kiwify respondeu ${res.status} ao listar produtos: ${motivo}`);
    }

    const body = (await res.json()) as {
      data?: Array<{ id?: string; name?: string; status?: string }>;
    };

    return (body.data ?? [])
      .filter((p): p is { id: string; name?: string; status?: string } =>
        Boolean(p && typeof p.id === 'string'),
      )
      .map((p) => ({
        id: p.id,
        // Produto sem nome não é motivo para perder a linha: o id ainda é o que
        // se mapeia, e uma linha sem rótulo é melhor que uma oferta invisível.
        name: p.name ?? p.id,
        status: p.status ?? 'unknown',
      }));
  }

  private async detalharProduto(
    cred: KiwifyCredenciais,
    accessToken: string,
    productId: string,
  ): Promise<KiwifyProduct | null> {
    const res = await this.req(`${BASE}/products/${encodeURIComponent(productId)}`, {
      headers: this.headers(cred, accessToken),
    });

    // Produto que sumiu entre a listagem e o detalhe não derruba a rodada: o
    // retrato sai sem ele, que é a verdade. Lançar aqui perderia o catálogo
    // inteiro por causa de uma linha.
    if (res.status === 404) {
      this.logger.warn(`Produto ${productId} sumiu entre a lista e o detalhe`);
      return null;
    }

    if (!res.ok) {
      const motivo = await this.motivo(res);
      throw new Error(`Kiwify respondeu ${res.status} ao detalhar produto: ${motivo}`);
    }

    const body = (await res.json()) as {
      id?: string;
      name?: string;
      status?: string;
      offers?: Array<{ id?: string; name?: string; active?: boolean }>;
    };

    const offers = Array.isArray(body.offers) ? body.offers : [];

    return {
      id: typeof body.id === 'string' ? body.id : productId,
      name: typeof body.name === 'string' ? body.name : productId,
      status: typeof body.status === 'string' ? body.status : 'unknown',
      offers: offers
        .filter((o): o is { id: string; name?: string; active?: boolean } =>
          Boolean(o && typeof o.id === 'string'),
        )
        // `active !== false` e não `active === true`: campo ausente numa oferta
        // que existe significa "a Kiwify não disse", e tratar silêncio como
        // "inativa" esconderia a oferta — o modo de errar que esta fatia mata.
        .filter((o) => o.active !== false)
        .map((o) => ({ id: o.id, name: o.name ?? o.id })),
    };
  }

  /** Toda rota da API pública exige os dois (`x-kiwify-account-id` inclusive). */
  private headers(cred: KiwifyCredenciais, accessToken: string): Record<string, string> {
    return {
      authorization: `Bearer ${accessToken}`,
      'x-kiwify-account-id': cred.accountId,
    };
  }

  /**
   * A mensagem legível do erro, ou o status nu.
   *
   * Nunca lança: já estamos no caminho de erro, e um corpo ilegível não pode
   * substituir o erro real por um de parse.
   */
  private async motivo(res: Response): Promise<string> {
    try {
      const body = (await res.json()) as { message?: string; error?: string };
      return body.message ?? body.error ?? `HTTP ${res.status}`;
    } catch {
      return `HTTP ${res.status}`;
    }
  }

  /**
   * `fetch` com timeout.
   *
   * Sem ele, uma API que aceita a conexão e não responde deixa o job pendurado
   * — e o retrato nunca é atualizado nem marcado como falho, que é o pior dos
   * dois mundos: a tela mostraria idade crescente sem nenhum `fetchError`
   * explicando.
   */
  private async req(url: string, init: RequestInit = {}): Promise<Response> {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    try {
      return await fetch(url, { ...init, signal: ctrl.signal });
    } catch (erro) {
      // A URL entra na mensagem; o corpo (com as credenciais) nunca. O `cause`
      // preserva o erro original (abort por timeout, DNS, TLS) para o log —
      // sem ele, "falha de rede" seria tudo o que sobraria para diagnosticar.
      const causa = erro instanceof Error ? erro.message : String(erro);
      throw new Error(`Falha de rede ao falar com a Kiwify: ${causa}`, { cause: erro });
    } finally {
      clearTimeout(t);
    }
  }
}
