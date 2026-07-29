import { RateLimitError } from '../../board/domain/rate-limit';

/**
 * As salvaguardas do bloco de repos ao vivo (SPEC-035 §2.11, §7.2).
 *
 * O bloco lê Issues **ao vivo no carregamento** — decisão 2 do PI, tomada
 * contra o custo apontado: N chamadas ao GitHub por load, no mesmo rate limit
 * que o catálogo e o sync consomem, e a tela refém de um terceiro. As quatro
 * salvaguardas **não eliminam** isso; elas contêm o dano. O que permanece é a
 * dependência, e o §7.2 registra o gatilho de revisão.
 */

/**
 * Quantos repos são consultados por carga do dashboard.
 *
 * **Decisão do PI, 2026-07-29.** Sem teto, um tenant com 40 repos faria 40
 * chamadas ao GitHub por F5 (§2.11). O excedente não é escondido: fica sob
 * *"ver todos"*, e o bloco diz quantos ficaram de fora — silêncio aqui leria
 * como *"são só estes"*, que é afirmação diferente.
 */
export const MAX_REPOS_POR_CARGA = 10;

/** Timeout por repo. Curto de propósito: a tela abre sem o bloco, não depois dele. */
export const TIMEOUT_POR_REPO_MS = 5_000;

/**
 * Por que um repo não pôde ser lido.
 *
 * A distinção existe porque as três pedem **texto diferente** na tela, e
 * colapsá-las produziria o pior resultado possível deste bloco: um zero que
 * parece contagem. `rate_limit` em especial — o §2.11 é literal em *"nunca zero
 * silencioso, que seria indistinguível de board vazio"*.
 */
export type RepoFailureKind = 'rate_limit' | 'timeout' | 'error';

export interface RepoColumnCount {
  column: string;
  count: number;
}

/** Um repo lido com sucesso. */
export interface RepoBoardOk {
  status: 'ok';
  projectId: string;
  repo: string;
  columns: RepoColumnCount[];
}

/** Um repo que falhou — **nomeado**, como o §2.11 exige. */
export interface RepoBoardFailed {
  status: 'failed';
  projectId: string;
  repo: string;
  reason: RepoFailureKind;
  /**
   * Quando o limite do GitHub volta — ISO. Só em `rate_limit`, e é o que
   * transforma *"não deu"* em *"volta às 14h32"*.
   */
  retryAt: string | null;
}

export type RepoBoardResult = RepoBoardOk | RepoBoardFailed;

export interface ReposBlock {
  repos: RepoBoardResult[];
  /**
   * Repos que existem mas **não foram consultados** por causa do teto.
   *
   * Viaja explícito para a tela poder dizer *"+7 em ver todos"*. Omitir o número
   * faria a lista curta parecer completa.
   */
  notLoaded: number;
}

/**
 * Classifica a falha de leitura de um repo.
 *
 * As três razões pedem **texto diferente** na tela, e colapsá-las produziria o
 * pior resultado deste bloco: um zero que parece contagem.
 *
 * `RateLimitError` vem do `board` — é lá que a conversa com o GitHub acontece
 * e onde os headers existem. O dashboard só o reconhece.
 */
export function classificarFalha(erro: unknown): {
  reason: RepoFailureKind;
  retryAt: string | null;
} {
  if (erro instanceof RateLimitError) {
    return { reason: 'rate_limit', retryAt: erro.retryAt };
  }
  // `AbortSignal.timeout` rejeita com `TimeoutError`; o `name` é o contrato
  // estável aqui, não a classe (que varia entre runtime e polyfill).
  if (erro instanceof Error && (erro.name === 'TimeoutError' || erro.name === 'AbortError')) {
    return { reason: 'timeout', retryAt: null };
  }
  return { reason: 'error', retryAt: null };
}
