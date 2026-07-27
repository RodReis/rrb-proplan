import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { BriefingForm } from './BriefingForm';
import {
  UnreachableError,
  getCatalog,
  getState,
  type Catalog,
  type PublicState,
  type PublicStatus,
} from './briefingApi';

/**
 * Página pública do link de briefing — `/b/:token`.
 *
 * **Quem abre não tem conta**: é o cliente do prestador. Por isso esta rota vive
 * fora de todo guard de sessão, e as chamadas não usam o `request()` do
 * `lib/api` (que trata 401 como "precisa logar") — ver `briefingApi.ts`.
 *
 * Link válido rende o formulário de 9 etapas (SPEC-031 §1); qualquer outro
 * estado rende só o texto correspondente, sem vazar o que a API esconde.
 */

/** Estados em que não há formulário — só a mensagem. */
type ClosedStatus = Exclude<PublicStatus, 'valid'>;

type State =
  | { status: 'loading' }
  | { status: 'closed'; linkStatus: ClosedStatus }
  | { status: 'open'; initial: PublicState; catalog: Catalog }
  /** Rede/servidor fora — distinto de token inválido, que é resposta legítima. */
  | { status: 'unreachable' };

/**
 * O texto de cada estado fechado. Nenhum menciona tenant, cliente ou projeto: a
 * resposta do backend é **não-diferencial** de propósito (SPEC-029), e vazar na
 * tela o que a API esconde anularia isso. "Inválido" e "não existe" dizem a mesma
 * coisa aqui, exatamente como no servidor.
 */
const COPY: Record<ClosedStatus, { title: string; body: string }> = {
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
  submitted: {
    title: 'Briefing recebido',
    body: 'Suas respostas já foram enviadas e estão com quem vai analisar o projeto. Não é possível reabrir o formulário.',
  },
};

export function BriefingLinkPage() {
  const { token = '' } = useParams();
  const [state, setState] = useState<State>({ status: 'loading' });

  useEffect(() => {
    const controller = new AbortController();

    void (async () => {
      try {
        const initial = await getState(token, controller.signal);
        if (initial.status !== 'valid') {
          return setState({ status: 'closed', linkStatus: initial.status });
        }

        // O catálogo só é buscado para link válido: pedir antes gastaria uma
        // requisição para descobrir o que o primeiro GET já disse.
        const catalog = await getCatalog(token, controller.signal);
        setState({ status: 'open', initial, catalog });
      } catch (err) {
        if (controller.signal.aborted) return;
        // 429 e 5xx não são veredito sobre o token — tratar como inválido
        // acusaria o visitante de ter um link ruim que talvez seja bom.
        if (err instanceof UnreachableError) return setState({ status: 'unreachable' });
        setState({ status: 'closed', linkStatus: 'invalid' });
      }
    })();

    return () => controller.abort();
  }, [token]);

  /** O link morreu no meio do preenchimento (revogado enquanto respondia). */
  const handleLinkGone = useCallback(
    () => setState({ status: 'closed', linkStatus: 'invalid' }),
    [],
  );

  if (state.status === 'open') {
    return (
      <main className="min-h-screen bg-bg">
        <BriefingForm
          token={token}
          initial={state.initial}
          catalog={state.catalog}
          onLinkGone={handleLinkGone}
        />
      </main>
    );
  }

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

        {state.status === 'closed' && (
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
