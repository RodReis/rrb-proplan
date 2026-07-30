import { useNavigate } from 'react-router-dom';
import { useDashboardNav } from './useDashboardNav';

/**
 * Ícones do menu global (mesmo traço do `TabIcon` do workspace: 24×24, stroke
 * 1.7, currentColor).
 */
const ICONS: Record<string, string> = {
  dashboard: 'M3 3h7v7H3zM14 3h7v7h-7zM14 14h7v7h-7zM3 14h7v7H3z',
  proplan: 'M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z',
  kanban: 'M4 4v16M10 4v10M16 4v16M4 4h16',
  clients: 'M16 21v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2M9 7a4 4 0 108 0 4 4 0 10-8 0M22 21v-2a4 4 0 00-3-3.87',
  contracts:
    'M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8zM14 2v6h6M9 13h6M9 17h4',
  // Chave: o objeto que a fatia inteira produz.
  licenses:
    'M21 2l-2 2m-7.61 7.61a5.5 5.5 0 11-7.778 7.778 5.5 5.5 0 017.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4',
  settings:
    'M12 15a3 3 0 100-6 3 3 0 000 6zM19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 11-4 0v-.09A1.65 1.65 0 008 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 11-2.83-2.83l.06-.06A1.65 1.65 0 004.6 15a1.65 1.65 0 00-1.51-1H3a2 2 0 110-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 112.83-2.83l.06.06A1.65 1.65 0 009 4.6a1.65 1.65 0 001-1.51V3a2 2 0 114 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 112.83 2.83l-.06.06A1.65 1.65 0 0019.4 9V9a1.65 1.65 0 001.51 1H21a2 2 0 110 4h-.09a1.65 1.65 0 00-1.51 1z',
};

function NavIcon({ id }: { id: string }) {
  return (
    <svg
      aria-hidden
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="shrink-0"
    >
      <path d={ICONS[id] ?? ICONS.clients} />
    </svg>
  );
}

/**
 * Menu global de primeiro nível (referência visual do PI, 2026-07-25).
 *
 * Fica ACIMA do workspace de repo, não dentro dele: a Frente Clientes não tem
 * repositório, e exigir um repo aberto para chegar em Clientes a tornaria
 * inalcançável com o GitHub desconectado — que é justamente o estado em que ela
 * deve funcionar (ADR-024).
 *
 * **`Dashboard` acendeu na Fatia 24** (SPEC-035). Ele nasceu desabilitado na
 * Fatia 19, com o motivo no `title`, porque depender de estimativa e contratos
 * que não existiam obrigaria a inventar números — o que o MVP3 §9 proíbe.
 * Agora as fontes existem, e a regra mudou de forma: o item **some** quando o
 * tenant não tem cliente nenhum (§2.12, decisão do PI). Some ≠ aparecer vazio,
 * pelo mesmo princípio de antes — uma tela de retomada sem nada a retomar não é
 * informação, é ruído no menu.
 */
export function GlobalNav({ tenant, section }: { tenant: string; section: string }) {
  const navigate = useNavigate();
  // O item some sem cliente (§2.12) e o contador atualiza ao navegar e ao voltar
  // o foco, sem polling (§2.10) — as duas coisas vêm do mesmo hook, porque as
  // duas dependem do mesmo estado do servidor.
  const { hasClients, pendingCount } = useDashboardNav(Boolean(tenant));

  const normalized = section.toLowerCase();
  const activeDashboard = normalized === 'dashboard';
  const activeProPlan = normalized === 'proplan' || normalized === 'catálogo';
  const activeClients = normalized === 'clientes';
  const activeContracts = normalized === 'contratos';
  const activeLicenses = normalized === 'licenças';
  const activeFunnel = normalized === 'funil' || normalized === 'kanban';

  const itemClass = (active: boolean) =>
    'relative flex w-full items-center gap-2.5 rounded-[9px] py-2 pl-3 pr-2.5 text-left text-[12.5px] transition-colors duration-150 ' +
    (active
      ? 'bg-card font-semibold text-text'
      : 'text-body2 hover:bg-card hover:text-text');

  return (
    <aside className="flex h-full w-[216px] shrink-0 flex-col border-r border-border bg-panel max-[720px]:h-auto max-[720px]:w-full max-[720px]:border-b max-[720px]:border-r-0">
      <div className="flex items-center gap-2.5 px-4 py-4 max-[720px]:py-3">
        <span className="grid h-7 w-7 place-items-center rounded-[7px] bg-btnbg text-[13px] font-bold text-btnfg">
          P
        </span>
        <span className="leading-tight">
          <span className="block text-[13px] font-semibold text-text">ProPlan</span>
          <span className="block font-mono text-[9px] uppercase tracking-[0.14em] text-faint">
            Painel
          </span>
        </span>
      </div>

      <nav className="min-h-0 flex-1 overflow-y-auto px-3 pb-3 max-[720px]:overflow-x-auto max-[720px]:pb-3">
        <ul className="flex flex-col gap-0.5 max-[720px]:w-max max-[720px]:flex-row">
          {/* Dashboard (SPEC-035, Fatia 24) — acesa nesta fatia.
              **Some quando o tenant não tem cliente nenhum** (decisão do PI,
              §2.12), que é diferente de aparecer vazia: uma tela de retomada sem
              nada a retomar não é informação, é ruído no menu. */}
          {hasClients && (
            <li>
              <button
                onClick={() => navigate(`/t/${tenant}/dashboard`)}
                className={itemClass(activeDashboard)}
                disabled={!tenant}
              >
                {activeDashboard && <ActiveBar />}
                <span className={activeDashboard ? 'text-accent' : undefined}>
                  <NavIcon id="dashboard" />
                </span>
                Dashboard
                {/* O contador é EXATAMENTE o tamanho da lista de *Esperando
                    você* (§2.3) — os dois saem do mesmo caminho de dado no
                    servidor. `null` (falha) não vira zero: sem badge é honesto,
                    zero afirmaria que nada espera. */}
                {pendingCount !== null && pendingCount > 0 && (
                  <span
                    aria-label={`${pendingCount} esperando você`}
                    className="ml-auto rounded-full border border-accentBorder bg-accentSoft px-1.5 py-px font-mono text-[10px] text-text2"
                  >
                    {pendingCount}
                  </span>
                )}
              </button>
            </li>
          )}

          <li>
            <button onClick={() => navigate('/')} className={itemClass(activeProPlan)}>
              {activeProPlan && <ActiveBar />}
              <span className={activeProPlan ? 'text-accent' : undefined}>
                <NavIcon id="proplan" />
              </span>
              ProPlan
            </button>
          </li>

          <li>
            <button
              onClick={() => navigate(`/t/${tenant}/clients/funil`)}
              className={itemClass(activeFunnel)}
              disabled={!tenant}
            >
              {activeFunnel && <ActiveBar />}
              <span className={activeFunnel ? 'text-accent' : undefined}>
                <NavIcon id="kanban" />
              </span>
              Kanban
            </button>
          </li>

          <li>
            <button
              onClick={() => navigate(`/t/${tenant}/clients`)}
              className={itemClass(activeClients)}
              disabled={!tenant}
            >
              {activeClients && <ActiveBar />}
              <span className={activeClients ? 'text-accent' : undefined}>
                <NavIcon id="clients" />
              </span>
              Clientes
            </button>
          </li>

          <li>
            {/* Perfil do prestador + modelos (SPEC-034). Item próprio, e não
                uma gaveta do projeto, porque os dois dados são um por tenant. */}
            <button
              onClick={() => navigate(`/t/${tenant}/clients/contratos`)}
              className={itemClass(activeContracts)}
              disabled={!tenant}
            >
              {activeContracts && <ActiveBar />}
              <span className={activeContracts ? 'text-accent' : undefined}>
                <NavIcon id="contracts" />
              </span>
              Contratos
            </button>
          </li>

          <li>
            {/* Licenças (SPEC-036, Fatia 25 — 1ª do MVP4). Item próprio, e não
                sub-aba de Contratos: licenciamento é frente disjunta — um
                produto licenciado não é um cliente, e o contrato de prestação
                não tem nada a ver com a licença de um binário.

                **O item NÃO some sem produto**, ao contrário do Dashboard — e a
                SPEC-040 §A área pede que suma. A decisão do PI (2026-07-30) veio
                de um impasse que a spec não previu: o menu é o único caminho
                para a área, e é *dentro* dela que se cadastra o primeiro
                produto. Escondê-lo deixaria o licenciamento inalcançável em
                todo tenant novo — nem `/settings` serve de porta, porque ela é
                global e não tem tenant.

                O que a regra do "some" queria evitar — ruído no menu de quem não
                vende software — é resolvido pela própria área: sem produto, ela
                explica o que é licenciamento e diz para ignorar se não for o
                caso. `hasLicensing` continua vindo do hook, sem uso aqui: quando
                houver uma porta alternativa, é ele que volta a esconder o item. */}
            <button
              onClick={() => navigate(`/t/${tenant}/licencas`)}
              className={itemClass(activeLicenses)}
              disabled={!tenant}
            >
              {activeLicenses && <ActiveBar />}
              <span className={activeLicenses ? 'text-accent' : undefined}>
                <NavIcon id="licenses" />
              </span>
              Licenças
            </button>
          </li>

          <li>
            <button onClick={() => navigate('/settings')} className={itemClass(normalized === 'configuração')}>
              {normalized === 'configuração' && <ActiveBar />}
              <span className={normalized === 'configuração' ? 'text-accent' : undefined}>
                <NavIcon id="settings" />
              </span>
              Configuração
            </button>
          </li>
        </ul>
      </nav>
    </aside>
  );
}

function ActiveBar() {
  return (
    <span
      aria-hidden
      className="absolute inset-y-1.5 left-0 w-[2.5px] rounded-full"
      style={{ background: 'var(--accent)' }}
    />
  );
}
