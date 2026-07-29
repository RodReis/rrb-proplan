import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  getDashboard,
  getDashboardRepos,
  type DashboardPeriod,
  type DashboardView,
  type PendingItem,
  type ReposBlock,
} from '../../lib/api';
import { ClientsShell } from './ClientsShell';
import {
  ACTIVITY_LABELS,
  FUNNEL_COLUMN_LABELS,
  activityText,
  PENDING_LABELS,
  PERIOD_OPTIONS,
  REPO_COLUMN_LABELS,
  contractsSummary,
  dataCurta,
  haQuantoTempo,
  pendingHref,
  repoFailureText,
  repoTally,
} from './dashboardView';

type State =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; view: DashboardView };

/** O bloco de repos tem estado PRÓPRIO — a falha dele não derruba a tela (§2.11). */
type ReposState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; block: ReposBlock };

/**
 * Dashboard (SPEC-035) — `/t/:tenant/dashboard`. Última tela do MVP3.
 *
 * **Não é um resumo do funil, é uma tela de retomada** (decisão do PI): *o que
 * andou por aqui*, *o que espera por você*, o funil de clientes e o Kanban de
 * repos — **sem nenhum número somando os dois domínios** (ADR-023, §2.4).
 *
 * **O risco desta tela não é técnico, é de honestidade** (§1). Todo número aqui
 * vem do servidor, com origem rastreável em linhas do banco; nenhum é calculado
 * ou combinado aqui. Onde o dado não existe, a tela **diz isso** em vez de
 * mostrar zero — *"você ainda não emitiu contrato"* e *"nenhum contrato no
 * período"* são frases diferentes de propósito (§2.7).
 *
 * **Duas chamadas, não uma** (§6): os blocos locais vêm juntos, e o de repos vai
 * à parte, porque ele depende do GitHub e a falha dele não pode contaminar o
 * resto.
 */
export function DashboardPage() {
  const { tenant = '' } = useParams();
  const [period, setPeriod] = useState<DashboardPeriod>('30');
  const [state, setState] = useState<State>({ status: 'loading' });
  const [repos, setRepos] = useState<ReposState>({ status: 'loading' });
  const agora = new Date();

  const load = useCallback(async (p: DashboardPeriod) => {
    setState({ status: 'loading' });
    try {
      setState({ status: 'ready', view: await getDashboard(p) });
    } catch (err) {
      setState({
        status: 'error',
        message: err instanceof Error ? err.message : 'falha ao carregar o dashboard',
      });
    }
  }, []);

  useEffect(() => {
    void load(period);
  }, [load, period]);

  // O bloco de repos carrega UMA vez, fora do período: a contagem do GitHub é
  // do momento, não de uma janela (§2.6).
  useEffect(() => {
    let vivo = true;
    getDashboardRepos()
      .then((block) => vivo && setRepos({ status: 'ready', block }))
      .catch(() => vivo && setRepos({ status: 'error' }));
    return () => {
      vivo = false;
    };
  }, []);

  return (
    <ClientsShell
      tenant={tenant}
      title="Dashboard"
      subtitle="O que andou por aqui e o que espera por você"
      actions={<SeletorPeriodo value={period} onChange={setPeriod} />}
    >
      {state.status === 'loading' && <Aviso>Carregando…</Aviso>}
      {state.status === 'error' && <Aviso tom="erro">{state.message}</Aviso>}

      {state.status === 'ready' && (
        <div className="grid gap-4">
          <BlocoEsperandoVoce items={state.view.pending} tenant={tenant} agora={agora} />

          <div className="grid gap-4 min-[1100px]:grid-cols-2">
            <BlocoAtividade entries={state.view.activity} />
            <BlocoFunil view={state.view} />
          </div>

          {/* Bloco separado, e a separação é o ponto: nenhum número daqui soma
              com os de cima (ADR-023). */}
          <BlocoRepos state={repos} />
        </div>
      )}
    </ClientsShell>
  );
}

function SeletorPeriodo({
  value,
  onChange,
}: {
  value: DashboardPeriod;
  onChange: (p: DashboardPeriod) => void;
}) {
  return (
    <div className="flex items-center gap-1" role="group" aria-label="Período">
      {PERIOD_OPTIONS.map((opt) => (
        <button
          key={opt.value}
          onClick={() => onChange(opt.value)}
          aria-pressed={value === opt.value}
          className={
            'rounded-[7px] border px-2.5 py-1 text-[11px] transition-colors ' +
            (value === opt.value
              ? 'border-accentBorder bg-accentSoft text-text'
              : 'border-border2 text-body hover:bg-card hover:text-text')
          }
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

/**
 * *Esperando você* — a lista fechada de 4 tipos (§2.3).
 *
 * O contador do menu é **o tamanho desta lista**, e os dois saem do mesmo
 * caminho de dado no servidor. Se pudessem divergir, o contador viraria enfeite.
 */
function BlocoEsperandoVoce({
  items,
  tenant,
  agora,
}: {
  items: PendingItem[];
  tenant: string;
  agora: Date;
}) {
  return (
    <Bloco titulo="Esperando você" contagem={items.length}>
      {items.length === 0 ? (
        <Vazio>Nada esperando por você agora.</Vazio>
      ) : (
        <ul className="grid gap-1.5">
          {items.map((item, i) => (
            <li key={`${item.kind}-${item.clientProjectId}-${i}`}>
              <ItemPendente item={item} tenant={tenant} agora={agora} />
            </li>
          ))}
        </ul>
      )}
    </Bloco>
  );
}

/**
 * Um item — **link quando há destino, texto quando não há** (§7.3).
 *
 * A regra não é estilística: um link que leva a 404 ensina a pessoa a
 * desconfiar de todos os outros. Quem decide se há destino é o servidor.
 */
function ItemPendente({
  item,
  tenant,
  agora,
}: {
  item: PendingItem;
  tenant: string;
  agora: Date;
}) {
  const href = pendingHref(item, tenant);
  const conteudo = (
    <>
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="truncate text-[12.5px] text-text2">{item.title}</span>
        <span className="truncate text-[11px] text-faint">{item.detail}</span>
      </span>
      <span className="flex shrink-0 items-center gap-2">
        <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-faint">
          {PENDING_LABELS[item.kind]}
        </span>
        <span className="text-[11px] text-faint">{haQuantoTempo(item.since, agora)}</span>
      </span>
    </>
  );

  const base =
    'flex items-center justify-between gap-3 rounded-[9px] border border-border2 bg-surface2 px-3 py-2';

  return href ? (
    <Link to={href} className={`${base} transition-colors hover:border-hoverb hover:bg-card`}>
      {conteudo}
    </Link>
  ) : (
    // Sem destino: `div`, não `<a>` sem href — um link que não navega é pior
    // que um texto, porque promete o que não cumpre.
    <div className={base}>{conteudo}</div>
  );
}

/**
 * *"O que andou por aqui"* — as três trilhas que já existem (§2.2).
 *
 * Rotulado por **tenant**, não por usuário: só `client_status_transitions` tem
 * coluna de ator, e prometer um filtro que duas das três trilhas não suportam
 * seria pior que renomear o bloco (§7.1).
 */
function BlocoAtividade({ entries }: { entries: DashboardView['activity'] }) {
  // Altura limitada com rolagem própria: a trilha é a lista mais longa da tela,
  // e deixá-la crescer livre empurra o bloco vizinho para longe da dobra — o
  // funil ficaria abaixo de doze linhas de auditoria.
  return (
    <Bloco titulo="O que andou por aqui">
      {entries.length === 0 ? (
        // Estado vazio COM TEXTO, não lista em branco — critério de aceite (§5).
        <Vazio>Nada registrado no período.</Vazio>
      ) : (
        <ul className="grid max-h-[330px] gap-1.5 overflow-y-auto pr-1">
          {entries.map((e, i) => (
            <li
              key={`${e.kind}-${e.at}-${i}`}
              className="flex items-center justify-between gap-3 rounded-[9px] border border-border2 bg-surface2 px-3 py-2"
            >
              <span className="flex min-w-0 flex-col gap-0.5">
                {e.title && (
                  <span className="truncate text-[12.5px] text-text2">{e.title}</span>
                )}
                <span className="truncate text-[11px] text-faint">
                  {activityText(e)}
                </span>
              </span>
              <span className="flex shrink-0 items-center gap-2">
                <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-faint">
                  {ACTIVITY_LABELS[e.kind]}
                </span>
                <span className="text-[11px] text-faint">{dataCurta(e.at)}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </Bloco>
  );
}

/** Funil de clientes: contagem por coluna + o estado dos contratos (§2.5). */
function BlocoFunil({ view }: { view: DashboardView }) {
  const contratos = contractsSummary(view.contracts);

  return (
    <Bloco titulo="Funil de clientes">
      <div className="grid grid-cols-2 gap-2 min-[560px]:grid-cols-4">
        {view.funnel.map((col) => (
          <div
            key={col.column}
            className="rounded-[9px] border border-border2 bg-surface2 px-3 py-2.5"
          >
            <span className="block font-mono text-[9px] uppercase tracking-[0.12em] text-faint">
              {FUNNEL_COLUMN_LABELS[col.column] ?? col.column}
            </span>
            <span className="mt-1 block text-[20px] font-semibold leading-none text-text">
              {col.count}
            </span>
          </div>
        ))}
      </div>

      {/* Contratos: `never` e `zero` renderizam DIFERENTE — é o §2.7 em pixels. */}
      <p
        className={
          'mt-3 text-[11.5px] ' +
          (contratos.kind === 'never' ? 'italic text-faint' : 'text-body')
        }
      >
        {contratos.text}
      </p>
    </Bloco>
  );
}

/**
 * Kanban de repos, **ao vivo** (§2.6) — com as 4 salvaguardas visíveis (§2.11).
 *
 * Bloco separado, sem nenhum total que o some com o funil de clientes: os
 * domínios são disjuntos (ADR-023), e um número cruzando os dois afirmaria uma
 * equivalência que não existe.
 */
function BlocoRepos({ state }: { state: ReposState }) {
  if (state.status === 'loading') {
    return (
      <Bloco titulo="Kanban de repos">
        <Vazio>Consultando o GitHub…</Vazio>
      </Bloco>
    );
  }

  if (state.status === 'error') {
    // A falha do bloco inteiro é contida aqui: o resto do dashboard já
    // renderizou acima (§2.11, salvaguarda 1).
    return (
      <Bloco titulo="Kanban de repos">
        <Vazio tom="erro">Não foi possível consultar o GitHub agora.</Vazio>
      </Bloco>
    );
  }

  const { repos, notLoaded } = state.block;
  const tally = repoTally(repos);

  return (
    <Bloco
      titulo="Kanban de repos"
      nota={
        notLoaded > 0
          ? `${tally.ok + tally.failed} de ${tally.ok + tally.failed + notLoaded} repos`
          : undefined
      }
    >
      {repos.length === 0 ? (
        <Vazio>Nenhum repositório com o App instalado.</Vazio>
      ) : (
        <ul className="grid gap-2">
          {repos.map((r) => (
            <li
              key={r.projectId}
              className="rounded-[9px] border border-border2 bg-surface2 px-3 py-2.5"
            >
              <span className="block truncate font-mono text-[11px] text-body2">
                {r.repo}
              </span>

              {r.status === 'ok' ? (
                <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
                  {r.columns.map((c) => (
                    <span key={c.column} className="flex items-baseline gap-1.5">
                      <span className="text-[13px] font-semibold text-text">{c.count}</span>
                      <span className="text-[10.5px] text-faint">
                        {REPO_COLUMN_LABELS[c.column] ?? c.column}
                      </span>
                    </span>
                  ))}
                </div>
              ) : (
                // NUNCA zero: o repo que falhou diz o que houve, nomeado — zero
                // aqui seria indistinguível de "board vazio" (§2.11).
                <p className="mt-1.5 text-[11.5px] text-warning-strong">
                  {repoFailureText(r.reason, r.retryAt)}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}

      {notLoaded > 0 && (
        <p className="mt-2 text-[11px] text-faint">
          Mais {notLoaded} repositório{notLoaded > 1 ? 's' : ''} não consultado
          {notLoaded > 1 ? 's' : ''} nesta carga.
        </p>
      )}
    </Bloco>
  );
}

function Bloco({
  titulo,
  contagem,
  nota,
  children,
}: {
  titulo: string;
  contagem?: number;
  nota?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-[12px] border border-border bg-surface px-4 py-3.5">
      <header className="mb-3 flex items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-[13px] font-semibold text-text">
          {titulo}
          {contagem !== undefined && contagem > 0 && (
            <span className="rounded-full border border-accentBorder bg-accentSoft px-1.5 py-px font-mono text-[10px] text-text2">
              {contagem}
            </span>
          )}
        </h2>
        {nota && <span className="text-[11px] text-faint">{nota}</span>}
      </header>
      {children}
    </section>
  );
}

function Vazio({ children, tom }: { children: React.ReactNode; tom?: 'erro' }) {
  return (
    <p className={`text-[12px] ${tom === 'erro' ? 'text-warning-strong' : 'text-faint'}`}>
      {children}
    </p>
  );
}

function Aviso({ children, tom }: { children: React.ReactNode; tom?: 'erro' }) {
  return (
    <p className={`text-[12.5px] ${tom === 'erro' ? 'text-warning-strong' : 'text-body'}`}>
      {children}
    </p>
  );
}
