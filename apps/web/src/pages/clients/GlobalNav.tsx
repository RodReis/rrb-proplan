import { NavLink, useNavigate } from 'react-router-dom';

/**
 * Ícones do menu global (mesmo traço do `TabIcon` do workspace: 24×24, stroke
 * 1.7, currentColor).
 */
const ICONS: Record<string, string> = {
  dashboard: 'M3 3h7v7H3zM14 3h7v7h-7zM14 14h7v7h-7zM3 14h7v7H3z',
  proplan: 'M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z',
  kanban: 'M4 4v16M10 4v10M16 4v16M4 4h16',
  clients: 'M16 21v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2M9 7a4 4 0 108 0 4 4 0 10-8 0M22 21v-2a4 4 0 00-3-3.87',
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
 * **Escopo desta fatia** (decisão do PI): só `Clientes` e `Funil` são telas
 * novas. `ProPlan` leva ao catálogo, `Kanban` ao board de repos e `Configuração`
 * às settings — tudo rota que já existia. **`Dashboard` fica de fora**: é a
 * Fatia 24 (SPEC-034) e depende de estimativa e contratos que ainda não
 * existem; renderizá-lo agora exigiria números inventados, o que o MVP3 §9
 * proíbe. Por isso ele aparece desabilitado, com o motivo no `title` — some ≠
 * mentir sobre o que existe.
 */
export function GlobalNav({ tenant }: { tenant: string }) {
  const navigate = useNavigate();

  const itemClass = (active: boolean) =>
    'relative flex w-full items-center gap-2.5 rounded-[9px] py-2 pl-3 pr-2.5 text-left text-[12.5px] transition-colors duration-150 ' +
    (active
      ? 'bg-card font-semibold text-text'
      : 'text-body2 hover:bg-card hover:text-text');

  return (
    <aside className="flex h-full w-[216px] shrink-0 flex-col border-r border-border bg-panel">
      <div className="flex items-center gap-2.5 px-4 py-4">
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

      <nav className="min-h-0 flex-1 overflow-y-auto px-3 pb-3">
        <ul className="flex flex-col gap-0.5">
          <li>
            {/* Fatia 24 (SPEC-034): sem estimativa nem contratos, os cards do
                Dashboard não teriam fonte de dado real. */}
            <button
              disabled
              title="Disponível na Fatia 24"
              className="flex w-full cursor-not-allowed items-center gap-2.5 rounded-[9px] py-2 pl-3 pr-2.5 text-left text-[12.5px] text-dimmer"
            >
              <NavIcon id="dashboard" />
              Dashboard
            </button>
          </li>

          <li>
            <button onClick={() => navigate('/')} className={itemClass(false)}>
              <NavIcon id="proplan" />
              ProPlan
            </button>
          </li>

          <li>
            <NavLink to={`/t/${tenant}/clients`} end className={({ isActive }) => itemClass(isActive)}>
              {({ isActive }) => (
                <>
                  {isActive && (
                    <span
                      aria-hidden
                      className="absolute inset-y-1.5 left-0 w-[2.5px] rounded-full"
                      style={{ background: 'var(--accent)' }}
                    />
                  )}
                  <span className={isActive ? 'text-accent' : undefined}>
                    <NavIcon id="clients" />
                  </span>
                  Clientes
                </>
              )}
            </NavLink>
          </li>

          <li>
            <NavLink
              to={`/t/${tenant}/clients/funil`}
              className={({ isActive }) => itemClass(isActive)}
            >
              {({ isActive }) => (
                <>
                  {isActive && (
                    <span
                      aria-hidden
                      className="absolute inset-y-1.5 left-0 w-[2.5px] rounded-full"
                      style={{ background: 'var(--accent)' }}
                    />
                  )}
                  <span className={isActive ? 'text-accent' : undefined}>
                    <NavIcon id="kanban" />
                  </span>
                  Funil
                </>
              )}
            </NavLink>
          </li>

          <li>
            <button onClick={() => navigate('/settings')} className={itemClass(false)}>
              <NavIcon id="settings" />
              Configuração
            </button>
          </li>
        </ul>
      </nav>
    </aside>
  );
}
