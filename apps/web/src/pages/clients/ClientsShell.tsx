import type { ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import { useTheme } from '../../theme';

interface Props {
  tenant: string;
  title: string;
  subtitle: string;
  actions?: ReactNode;
  children: ReactNode;
}

const NAV = [
  { to: 'clientes', label: 'Clientes' },
  { to: 'funil', label: 'Funil' },
];

/**
 * Shell da Frente Clientes (SPEC-029) — rota `/t/:tenant/clients`.
 *
 * Shell PRÓPRIO, irmão do workspace de repo, não uma aba dele: o workspace
 * existente é `/t/:tenant/p/:project/:tab` e exige um repositório no path, que
 * um cliente não tem. Decisão do PI em 2026-07-25.
 *
 * Segue os tokens do Carbono/Claro (DESIGN.md §4) — nenhuma cor absoluta aqui.
 */
export function ClientsShell({ tenant, title, subtitle, actions, children }: Props) {
  const { theme, toggle } = useTheme();

  return (
    <div style={{ display: 'flex', minHeight: '100vh', background: 'var(--bg)' }}>
      <aside
        style={{
          width: 216,
          flexShrink: 0,
          borderRight: '1px solid var(--border)',
          background: 'var(--panel)',
          padding: '20px 12px',
        }}
      >
        <div style={{ padding: '0 8px 20px', color: 'var(--text)', fontWeight: 600 }}>
          ProPlan
          <div
            style={{
              fontSize: 11,
              letterSpacing: '0.08em',
              color: 'var(--dim)',
              fontWeight: 500,
            }}
          >
            CLIENTES
          </div>
        </div>

        <nav style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={`/t/${tenant}/${item.to === 'clientes' ? 'clients' : 'clients/funil'}`}
              end={item.to === 'clientes'}
              style={({ isActive }) => ({
                padding: '8px 10px',
                borderRadius: 6,
                fontSize: 14,
                textDecoration: 'none',
                color: isActive ? 'var(--text)' : 'var(--body)',
                background: isActive ? 'var(--surface2)' : 'transparent',
              })}
            >
              {item.label}
            </NavLink>
          ))}
          <NavLink
            to="/"
            style={{
              padding: '8px 10px',
              borderRadius: 6,
              fontSize: 14,
              textDecoration: 'none',
              color: 'var(--body)',
            }}
          >
            Catálogo
          </NavLink>
        </nav>
      </aside>

      <main style={{ flex: 1, minWidth: 0 }}>
        <header
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '14px 28px',
            borderBottom: '1px solid var(--border)',
          }}
        >
          <span style={{ fontSize: 12, color: 'var(--dim)', letterSpacing: '0.06em' }}>
            PROPLAN / <span style={{ color: 'var(--text2)' }}>{title}</span>
          </span>
          <button
            onClick={toggle}
            aria-label="Alternar tema"
            style={{
              background: 'transparent',
              border: '1px solid var(--border2)',
              borderRadius: 6,
              color: 'var(--body)',
              cursor: 'pointer',
              padding: '4px 10px',
              fontSize: 12,
            }}
          >
            {theme === 'carbono' ? 'Claro' : 'Carbono'}
          </button>
        </header>

        <div style={{ padding: '32px 28px', maxWidth: 1100 }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              justifyContent: 'space-between',
              gap: 16,
              marginBottom: 24,
            }}
          >
            <div>
              <h1 style={{ margin: 0, fontSize: 24, color: 'var(--text)' }}>{title}</h1>
              <p style={{ margin: '6px 0 0', fontSize: 14, color: 'var(--body)' }}>
                {subtitle}
              </p>
            </div>
            {actions}
          </div>
          {children}
        </div>
      </main>
    </div>
  );
}
