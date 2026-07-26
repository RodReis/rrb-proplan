import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { API_URL } from '../../lib/api';

/**
 * Página pública do link de briefing (FIX #136) — `/b/:token`.
 *
 * **Quem abre não tem conta**: é o cliente do prestador. Por isso esta rota vive
 * fora de todo guard de sessão, e a chamada não usa o `request()` do `lib/api`
 * (que trata 401 como "precisa logar" e joga um `UnauthorizedError`).
 *
 * Antes deste FIX, o link apontava para a API e devolvia `{"status":"valid"}` cru
 * num host chamado `api.` — que para o destinatário parece link quebrado. O
 * conteúdo do formulário é a Fatia 20 (SPEC-031); esta página é o endereço
 * definitivo, e quando o formulário chegar ele substitui o corpo daqui. Nenhum
 * link já enviado quebra.
 */

type LinkStatus = 'valid' | 'expired' | 'revoked' | 'invalid';

type State =
  | { status: 'loading' }
  | { status: 'ready'; linkStatus: LinkStatus }
  /** Rede/servidor fora — distinto de token inválido, que é resposta legítima. */
  | { status: 'unreachable' };

/**
 * O texto de cada estado. Nenhum deles menciona tenant, cliente ou projeto: a
 * resposta do backend é **não-diferencial** de propósito (SPEC-029), e vazar na
 * tela o que a API esconde anularia isso. "Inválido" e "não existe" dizem a mesma
 * coisa aqui, exatamente como no servidor.
 */
const COPY: Record<LinkStatus, { title: string; body: string }> = {
  valid: {
    title: 'Link confirmado',
    body: 'Este link de briefing é válido. O formulário para você preencher estará disponível aqui em breve — guarde este endereço.',
  },
  expired: {
    title: 'Link expirado',
    body: 'O prazo deste link terminou. Peça um novo a quem o enviou.',
  },
  revoked: {
    title: 'Link cancelado',
    body: 'Este link foi cancelado por quem o enviou. Peça um novo para continuar.',
  },
  invalid: {
    title: 'Link inválido',
    body: 'Não foi possível reconhecer este endereço. Confira se ele foi copiado por inteiro, ou peça um novo a quem o enviou.',
  },
};

export function BriefingLinkPage() {
  const { token = '' } = useParams();
  const [state, setState] = useState<State>({ status: 'loading' });

  useEffect(() => {
    let active = true;

    // `fetch` direto, sem credenciais: rota pública. Um cookie de sessão aqui
    // não serviria para nada e só ampliaria a superfície.
    fetch(`${API_URL}/b/${encodeURIComponent(token)}`)
      .then(async (res) => {
        // 429 (rate limit) e 5xx não são veredito sobre o token — tratar como
        // inválido acusaria o visitante de ter um link ruim que talvez seja bom.
        if (!res.ok && res.status !== 404) {
          return active && setState({ status: 'unreachable' });
        }
        const body = (await res.json().catch(() => null)) as {
          status?: LinkStatus;
        } | null;
        const linkStatus = body?.status ?? 'invalid';
        if (active) setState({ status: 'ready', linkStatus });
      })
      .catch(() => active && setState({ status: 'unreachable' }));

    return () => {
      active = false;
    };
  }, [token]);

  return (
    <main className="flex min-h-screen items-center justify-center bg-bg px-4 py-10">
      <div className="w-full max-w-md rounded-[14px] border border-border bg-panel px-6 py-7">
        <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-faint">
          ProPlan · Briefing
        </p>

        {state.status === 'loading' && (
          <div className="mt-4 space-y-3" aria-busy="true">
            <div className="h-5 w-1/2 animate-pulse rounded bg-surface-hover" />
            <div className="h-4 w-full animate-pulse rounded bg-surface-hover" />
            <div className="h-4 w-3/4 animate-pulse rounded bg-surface-hover" />
          </div>
        )}

        {state.status === 'unreachable' && (
          <>
            <h1 className="mt-3 text-lg font-semibold text-text2">
              Não foi possível verificar agora
            </h1>
            <p className="mt-2 text-sm text-body2">
              Tente novamente em alguns instantes. Se persistir, avise quem enviou
              o link.
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

        {state.status === 'ready' && (
          <>
            <h1 className="mt-3 text-lg font-semibold text-text2">
              {COPY[state.linkStatus].title}
            </h1>
            <p className="mt-2 text-sm leading-relaxed text-body2">
              {COPY[state.linkStatus].body}
            </p>
          </>
        )}
      </div>
    </main>
  );
}
