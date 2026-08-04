import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import {
  GithubUnavailableError,
  LinkGoneError,
  UnreachableError,
  UserNotFoundError,
  getState,
  lookupUsername,
  setUsername,
  type GithubUserPreview,
  type SourceLinkState,
} from './sourceLinkApi';

/**
 * Página pública do link de coleta de username — `/s/:token` (SPEC-039).
 *
 * **Quem abre não tem conta**: é o comprador do produto. Por isso esta rota vive
 * fora de todo guard de sessão, e as chamadas não passam pelo `request()` do
 * `lib/api` — ver `sourceLinkApi.ts`.
 *
 * ## Duas etapas, e a segunda não é cerimônia
 *
 * 1. O comprador digita o login → consultamos o GitHub.
 * 2. Mostramos **avatar, nome e login** e pedimos confirmação explícita.
 *
 * Validar existência não é validar identidade: `GET /users/:login` confirma que o
 * login existe, não que é do comprador. Sem o passo 2, um typo convida um
 * estranho para um repositório privado — e o erro só apareceria quando o estranho
 * aceitasse. É por isso que o avatar é grande e o login vem em destaque: quem
 * confirma é a pessoa, olhando a foto.
 *
 * ## `noindex`, e por que na página também
 *
 * A URL **contém o token**, e o token concede acesso a código-fonte privado.
 * Indexada, ela entrega esse acesso a quem buscar. O header `X-Robots-Tag` vem da
 * API; esta meta cobre o caminho do HTML, e os dois existem porque nenhum cobre
 * o outro.
 */

/** Onde o comprador está no fluxo. */
type Fase =
  | { t: 'carregando' }
  /** Link não serve (usado ou inválido) — só a mensagem. */
  | { t: 'fechado'; motivo: 'used' | 'invalid' }
  /** Servidor/rede fora — distinto de veredito sobre o token. */
  | { t: 'indisponivel' }
  /** Formulário, com o produto que o link identificou. */
  | { t: 'formulario'; link: SourceLinkState }
  /** Consultado o GitHub, aguardando a confirmação do comprador. */
  | { t: 'confirmar'; link: SourceLinkState; usuario: GithubUserPreview }
  | { t: 'pronto'; login: string };

const COPY_FECHADO: Record<'used' | 'invalid', { title: string; body: string }> = {
  // "Já utilizado", nunca o formulário de novo — é critério de aceite. Quem
  // informou o username e recarregou a página precisa saber que deu certo, em vez
  // de concluir que o envio falhou e tentar outra vez.
  used: {
    title: 'Link já utilizado',
    body: 'O usuário do GitHub deste link já foi informado. Se você precisa corrigi-lo, responda ao e-mail que recebeu — a alteração é feita por nós.',
  },
  // "Inválido" e "não existe" dizem a mesma coisa aqui, exatamente como no
  // servidor: a resposta é não-diferencial de propósito, e vazar na tela o que a
  // API esconde anularia isso.
  invalid: {
    title: 'Link inválido',
    body: 'Não foi possível reconhecer este endereço. Confira se ele foi copiado por inteiro, ou responda ao e-mail que recebeu.',
  },
};

export function SourceLinkPage() {
  const { token = '' } = useParams();
  const [fase, setFase] = useState<Fase>({ t: 'carregando' });
  const [digitado, setDigitado] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  // `noindex` na própria página: a URL carrega o token.
  useEffect(() => {
    const meta = document.createElement('meta');
    meta.name = 'robots';
    meta.content = 'noindex, nofollow';
    document.head.appendChild(meta);
    return () => meta.remove();
  }, []);

  useEffect(() => {
    const controller = new AbortController();

    void (async () => {
      try {
        const link = await getState(token, controller.signal);
        if (link.status !== 'valid') {
          return setFase({ t: 'fechado', motivo: link.status });
        }
        setFase({ t: 'formulario', link });
      } catch (err) {
        if (controller.signal.aborted) return;
        // 429 e 5xx não são veredito sobre o token — tratá-los como inválido
        // acusaria o comprador de ter um link ruim que talvez seja bom. E aqui
        // isso é pior que no briefing: o link é de uso único, e não há outro sem
        // passar pelo admin.
        if (err instanceof LinkGoneError) {
          return setFase({ t: 'fechado', motivo: err.status });
        }
        // `GithubUnavailableError` entra aqui junto do `UnreachableError`, e
        // isso não é frouxidão: **no `GET` do link não existe GitHub envolvido**
        // — um `503` ali é a nossa API fora do ar, não o GitHub. As duas classes
        // significam a mesma coisa neste ponto: "não deu para saber". Só nas
        // chamadas de consulta/gravação a distinção passa a valer, porque lá o
        // `503` de fato vem do GitHub.
        //
        // Sem esta linha o `503` caía no `else` e a tela dizia **"Link
        // inválido"** — acusando de ruim um link intacto, que é de uso único e
        // não tem segunda via sem passar pelo admin.
        if (err instanceof UnreachableError || err instanceof GithubUnavailableError) {
          return setFase({ t: 'indisponivel' });
        }
        setFase({ t: 'fechado', motivo: 'invalid' });
      }
    })();

    return () => controller.abort();
  }, [token]);

  /** Etapa 1 → 2: consulta o GitHub e pede confirmação. */
  async function consultar() {
    if (fase.t !== 'formulario' || ocupado) return;
    const login = digitado.trim();
    if (!login) return;

    setOcupado(true);
    setErro(null);
    try {
      const usuario = await lookupUsername(token, login);
      setFase({ t: 'confirmar', link: fase.link, usuario });
    } catch (err) {
      tratar(err, login);
    } finally {
      setOcupado(false);
    }
  }

  /** Etapa 2: grava e queima o link. */
  async function confirmar() {
    if (fase.t !== 'confirmar' || ocupado) return;

    setOcupado(true);
    setErro(null);
    try {
      const { username } = await setUsername(token, fase.usuario.login);
      setFase({ t: 'pronto', login: username });
    } catch (err) {
      tratar(err, fase.usuario.login);
    } finally {
      setOcupado(false);
    }
  }

  /**
   * Traduz o erro em mensagem. Cada caso diz o que fazer a seguir — "erro
   * inesperado" sozinho deixa o comprador sem próximo passo, com o produto pago
   * e sem o código.
   */
  function tratar(err: unknown, login: string) {
    if (err instanceof UserNotFoundError) {
      // Nomeia o que foi procurado: sem isso, o comprador não sabe se errou a
      // digitação ou se o envio não funcionou.
      return setErro(
        `Não encontramos o usuário “${err.message || login}” no GitHub. Confira a grafia — é o nome que aparece em github.com/SEU-USUARIO.`,
      );
    }
    if (err instanceof GithubUnavailableError) {
      // NÃO é "usuário não existe". Dizer que é faria o comprador corrigir um
      // dado correto.
      return setErro(
        'Não foi possível falar com o GitHub agora. Tente novamente em alguns instantes — o seu usuário provavelmente está certo.',
      );
    }
    if (err instanceof LinkGoneError) {
      return setFase({ t: 'fechado', motivo: err.status });
    }
    setErro('Não foi possível concluir agora. Tente novamente em alguns instantes.');
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-bg px-4 py-10">
      <div className="w-full max-w-md rounded-[14px] border border-border bg-panel px-6 py-7">
        <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-faint">
          ProPlan · Acesso ao código-fonte
        </p>

        {fase.t === 'carregando' && (
          <div className="mt-4 space-y-3" aria-busy="true">
            <div className="h-5 w-1/2 animate-pulse rounded bg-surface-hover" />
            <div className="h-4 w-full animate-pulse rounded bg-surface-hover" />
            <div className="h-4 w-3/4 animate-pulse rounded bg-surface-hover" />
          </div>
        )}

        {fase.t === 'indisponivel' && (
          <>
            <h1 className="mt-3 text-lg font-semibold text-text2">
              Não foi possível verificar agora
            </h1>
            <p className="mt-2 text-sm text-body2">
              Tente novamente em alguns instantes. O seu link continua válido.
            </p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="mt-4 rounded-md border border-border2 px-3 py-1.5 text-xs font-semibold text-text2 transition-colors duration-150 hover:bg-surface-hover"
            >
              Tentar de novo
            </button>
          </>
        )}

        {fase.t === 'fechado' && (
          <>
            <h1 className="mt-3 text-lg font-semibold text-text2">
              {COPY_FECHADO[fase.motivo].title}
            </h1>
            <p className="mt-2 text-sm leading-relaxed text-body2">
              {COPY_FECHADO[fase.motivo].body}
            </p>
          </>
        )}

        {fase.t === 'formulario' && (
          <>
            <h1 className="mt-3 text-lg font-semibold text-text2">
              Qual é o seu usuário do GitHub?
            </h1>
            <p className="mt-2 text-sm leading-relaxed text-body2">
              Sua compra do <strong className="text-text2">{fase.link.product}</strong>
              {fase.link.edition ? ` — ${fase.link.edition}` : ''} inclui o
              código-fonte. Precisamos do seu usuário para enviar o convite ao
              repositório privado.
            </p>

            <label
              htmlFor="github-username"
              className="mt-5 block text-xs font-semibold text-text2"
            >
              Usuário do GitHub
            </label>
            <div className="mt-1.5 flex items-center gap-2">
              <span className="text-sm text-faint">@</span>
              <input
                id="github-username"
                value={digitado}
                onChange={(e) => setDigitado(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void consultar();
                }}
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                placeholder="seu-usuario"
                className="w-full rounded-md border border-border2 bg-surface px-3 py-2 text-sm text-text2 outline-none focus:border-accent"
              />
            </div>

            {erro && (
              <p role="alert" className="mt-3 text-sm leading-relaxed text-error">
                {erro}
              </p>
            )}

            <button
              type="button"
              onClick={() => void consultar()}
              disabled={ocupado || !digitado.trim()}
              className="mt-5 w-full rounded-md bg-accent px-3 py-2 text-sm font-semibold text-pop transition-opacity duration-150 disabled:opacity-50"
            >
              {ocupado ? 'Verificando…' : 'Continuar'}
            </button>

            <p className="mt-4 text-xs leading-relaxed text-faint">
              Usamos o seu usuário apenas para convidá-lo ao repositório do produto
              que você comprou.
            </p>
          </>
        )}

        {fase.t === 'confirmar' && (
          <>
            <h1 className="mt-3 text-lg font-semibold text-text2">É você?</h1>
            <p className="mt-2 text-sm leading-relaxed text-body2">
              O convite ao repositório será enviado para esta conta. Confira antes
              de confirmar.
            </p>

            <div className="mt-4 flex items-center gap-3 rounded-md border border-border2 bg-surface px-3 py-3">
              {/* O avatar é o que faz a confirmação funcionar: um typo passa
                  despercebido num login parecido, não numa foto de outra pessoa. */}
              {fase.usuario.avatarUrl && (
                <img
                  src={fase.usuario.avatarUrl}
                  alt=""
                  width={48}
                  height={48}
                  className="h-12 w-12 rounded-full border border-border2"
                />
              )}
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-text2">
                  @{fase.usuario.login}
                </p>
                {fase.usuario.name && (
                  <p className="truncate text-xs text-body2">{fase.usuario.name}</p>
                )}
              </div>
            </div>

            {erro && (
              <p role="alert" className="mt-3 text-sm leading-relaxed text-error">
                {erro}
              </p>
            )}

            <button
              type="button"
              onClick={() => void confirmar()}
              disabled={ocupado}
              className="mt-5 w-full rounded-md bg-accent px-3 py-2 text-sm font-semibold text-pop transition-opacity duration-150 disabled:opacity-50"
            >
              {ocupado ? 'Confirmando…' : 'Sim, sou eu — confirmar'}
            </button>
            <button
              type="button"
              onClick={() => {
                setErro(null);
                setFase({ t: 'formulario', link: fase.link });
              }}
              disabled={ocupado}
              className="mt-2 w-full rounded-md border border-border2 px-3 py-2 text-xs font-semibold text-text2 transition-colors duration-150 hover:bg-surface-hover disabled:opacity-50"
            >
              Não, corrigir o usuário
            </button>
          </>
        )}

        {fase.t === 'pronto' && (
          <>
            <h1 className="mt-3 text-lg font-semibold text-text2">Tudo certo</h1>
            <p className="mt-2 text-sm leading-relaxed text-body2">
              Registramos <strong className="text-text2">@{fase.login}</strong>.
              Você vai receber o convite do repositório por e-mail do próprio
              GitHub — é preciso aceitá-lo para ter acesso.
            </p>
            <p className="mt-3 text-sm leading-relaxed text-body2">
              Enviamos também uma confirmação para o seu e-mail. Se o usuário
              estiver errado, responda a ela.
            </p>
          </>
        )}
      </div>
    </main>
  );
}
