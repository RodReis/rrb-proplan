import { useEffect, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { setActiveTenant, type SessionUser } from '../lib/api';
import { useTheme } from '../theme';
import { GlobalNav } from '../pages/clients/GlobalNav';

interface Props {
  user: SessionUser;
  tenant?: string | null;
  section: string;
  onLogout: () => void;
  children: ReactNode;
}

/**
 * Shell global do app — menu esquerdo + topbar, conforme referência visual do PI
 * em 2026-07-25.
 *
 * Escopo assumido explicitamente pelo PI dentro da Fatia 19, sem spec nova:
 * ProPlan = Catálogo; Dashboard fica desabilitado até a Fatia 24; Clientes/Funil
 * são as telas novas desta fatia. O workspace de repo mantém sua sidebar interna
 * quando aberto — o menu global fica acima dela.
 */
export function AppShell({ user, tenant, section, onLogout, children }: Props) {
  const navigate = useNavigate();
  const { theme, toggle } = useTheme();
  const dark = theme === 'carbono';

  // Slug que o menu usa para montar as URLs (`/t/:tenant/...`).
  const slug = tenant ?? user.tenants[0]?.accountLogin ?? '';
  const membership = user.tenants.find(
    (t) => t.accountLogin.toLowerCase() === slug.toLowerCase(),
  );

  // FIX #230 — as telas GLOBAIS (Catálogo, Configuração) desenham o menu global
  // sem passar pelo `ClientsRoute`, que é quem fixa o tenant ativo. Sem ele o
  // `request()` não prefixa `/dashboard` com `/t/:tenant`, a API devolve 404, e
  // o `catch` do `useDashboardNav` deixa `hasClients` em `false` — o item
  // Dashboard SUMIA do menu ao entrar no Catálogo, reaparecendo nas telas de
  // cliente. Some por falta de tenant ativo ≠ some por não ter cliente, que é a
  // única razão que a SPEC-035 §2.12 admite.
  //
  // Solta ao desmontar, como o `ClientsRoute`: tenant fixo depois de sair faria
  // uma chamada global seguinte sair escopada por engano.
  useEffect(() => {
    if (!membership) return;
    setActiveTenant(membership.id);
    return () => setActiveTenant(null);
  }, [membership]);

  return (
    <div className="flex h-screen bg-bg text-text max-[720px]:flex-col">
      <GlobalNav tenant={slug} section={section} />

      <main className="flex min-h-0 min-w-0 flex-1 flex-col">
        <header className="flex h-[56px] shrink-0 items-center gap-3.5 border-b border-border bg-panel px-6 max-[720px]:px-3">
          <span className="font-mono text-[11px] uppercase tracking-[0.1em] text-dim">
            ProPlan <span className="px-1 text-dimmer">/</span>
            <span className="text-text2">{section}</span>
          </span>

          <div className="flex-1" />

          <button
            onClick={toggle}
            title={dark ? 'Mudar para o tema Claro' : 'Mudar para o tema Carbono'}
            aria-label={dark ? 'Mudar para o tema Claro' : 'Mudar para o tema Carbono'}
            className="flex h-[34px] w-[34px] items-center justify-center rounded-[9px] border border-border2 text-muted transition-colors duration-150 hover:border-hoverb hover:text-text"
          >
            <ThemeIcon dark={dark} />
          </button>

          <button
            onClick={() => navigate('/settings')}
            title="Configurações"
            aria-label="Configurações"
            className="flex h-[34px] w-[34px] items-center justify-center rounded-[9px] border border-border2 text-muted transition-colors duration-150 hover:border-hoverb hover:text-text"
          >
            <GearIcon />
          </button>

          <div className="flex items-center gap-2.5 border-l border-border pl-3.5 max-[720px]:gap-2 max-[720px]:pl-2">
            {user.avatarUrl ? (
              <img
                src={user.avatarUrl}
                alt=""
                className="h-[30px] w-[30px] rounded-full border border-border2"
              />
            ) : (
              <span className="flex h-[30px] w-[30px] items-center justify-center rounded-full bg-card text-xs font-semibold text-body2">
                {(user.name ?? user.login).charAt(0).toUpperCase()}
              </span>
            )}
            <span className="text-[13px] font-medium max-[720px]:hidden">{user.name ?? user.login}</span>
            <button
              onClick={onLogout}
              className="text-xs text-muted transition-colors duration-150 hover:text-text"
            >
              Sair
            </button>
          </div>
        </header>

        {children}
      </main>
    </div>
  );
}

function ThemeIcon({ dark }: { dark: boolean }) {
  return dark ? (
    <svg aria-hidden width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
    </svg>
  ) : (
    <svg aria-hidden width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </svg>
  );
}

function GearIcon() {
  return (
    <svg aria-hidden width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}
