import { API_URL } from '../../lib/api';

/**
 * Cliente HTTP da rota pública `/s/:token` (SPEC-039).
 *
 * **Não usa o `request()` do `lib/api`** (FIX #136, e a nota técnica da spec
 * repete): aquele trata `401` como "precisa logar", e quem informa o username
 * nunca vai ter conta no ProPlan. `fetch` cru, sem credenciais — cookie de sessão
 * aqui não serviria para nada e só ampliaria a superfície.
 *
 * **`429` e `5xx` não viram "link inválido"**, e esta é a regra que o arquivo
 * carrega. Acusar de ruim um link possivelmente bom manda o comprador pedir outro
 * sem necessidade — pior aqui que no briefing, porque este link é de uso único e
 * *não há outro* sem passar pelo admin.
 *
 * **Nada de `TENANT_SCOPED_PREFIXES`**: esta rota não vive sob `/t/:tenant`. Se
 * ela fosse pelo `request()`, o prefixo de tenant entraria no caminho e a API
 * responderia 404 — a falha muda do FIX #166.
 */

/** Estado do link, como a API o descreve. Sem `expired`: o link não tem prazo. */
export type SourceLinkStatus = 'valid' | 'used' | 'invalid';

export interface SourceLinkState {
  status: SourceLinkStatus;
  /** Só produto e edição. A API não devolve dado pessoal do comprador. */
  product?: string;
  edition?: string;
}

/** Quem o GitHub diz que é — o que a página mostra para confirmação. */
export interface GithubUserPreview {
  login: string;
  name: string | null;
  avatarUrl: string | null;
}

/** Rede fora ou servidor com problema — distinto de veredito sobre o token. */
export class UnreachableError extends Error {}

/** O link já foi usado (410) ou não existe (404). */
export class LinkGoneError extends Error {
  constructor(readonly status: 'used' | 'invalid') {
    super(status);
  }
}

/** O login não existe no GitHub (422). Traz o que foi procurado. */
export class UserNotFoundError extends Error {}

/**
 * O GitHub não respondeu (503 da nossa API).
 *
 * Separado de `UserNotFoundError` de propósito: dizer "esse usuário não existe"
 * quando o GitHub caiu faria o comprador corrigir um dado correto — ou desistir.
 */
export class GithubUnavailableError extends Error {}

function url(token: string, suffix = ''): string {
  return `${API_URL}/source-links/${encodeURIComponent(token)}${suffix}`;
}

/**
 * Traduz a resposta uma vez, para as três chamadas.
 *
 * A distinção entre `LinkGoneError` e `UnreachableError` é o coração daqui: a
 * primeira é veredito do servidor sobre o link, a segunda é "não deu para saber".
 */
async function parse<T>(res: Response): Promise<T> {
  if (res.ok) return (await res.json()) as T;

  if (res.status === 404) throw new LinkGoneError('invalid');
  if (res.status === 410) throw new LinkGoneError('used');
  if (res.status === 422) {
    const corpo = (await res.json().catch(() => ({}))) as { username?: string };
    // A mensagem nomeia o que foi procurado (critério de aceite): sem isso, o
    // comprador não sabe se errou a digitação ou se o envio não funcionou.
    throw new UserNotFoundError(corpo.username ?? '');
  }
  if (res.status === 503) throw new GithubUnavailableError();

  // 429 e o resto dos 5xx caem aqui — nunca em `LinkGoneError`.
  throw new UnreachableError(`HTTP ${res.status}`);
}

/** Abre o link. Devolve o estado; nunca lança para token inválido. */
export async function getState(
  token: string,
  signal?: AbortSignal,
): Promise<SourceLinkState> {
  // Esta rota responde 200 em todos os estados de link, inclusive `invalid` — o
  // status vem no corpo. É o que impede distinguir "não existe" de "já usado"
  // pelo código HTTP.
  const res = await fetch(url(token), { signal });
  return parse<SourceLinkState>(res);
}

/** Consulta o login no GitHub, sem gravar. */
export async function lookupUsername(
  token: string,
  username: string,
  signal?: AbortSignal,
): Promise<GithubUserPreview> {
  const res = await fetch(url(token, '/lookup'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username }),
    signal,
  });
  return parse<GithubUserPreview>(res);
}

/**
 * Grava o username e queima o link.
 *
 * `confirm: true` é obrigatório no servidor também — a tela só chega aqui depois
 * de mostrar avatar, nome e login, e a confirmação é uma das três mitigações do
 * risco de o comprador convidar um estranho por engano.
 */
export async function setUsername(
  token: string,
  username: string,
  signal?: AbortSignal,
): Promise<{ username: string }> {
  const res = await fetch(url(token, '/username'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, confirm: true }),
    signal,
  });
  return parse<{ username: string }>(res);
}
