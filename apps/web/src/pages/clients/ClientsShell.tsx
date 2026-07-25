import type { ReactNode } from 'react';
import { useTheme } from '../../theme';
import { GlobalNav } from './GlobalNav';

interface Props {
  tenant: string;
  title: string;
  subtitle: string;
  actions?: ReactNode;
  children: ReactNode;
}

/**
 * Shell da Frente Clientes (SPEC-029) — menu global à esquerda + conteúdo.
 *
 * O menu (`GlobalNav`) é de primeiro nível, acima do workspace de repo: um
 * cliente não tem repositório, e exigir um repo aberto para chegar em Clientes
 * a tornaria inalcançável com o GitHub desconectado — que é justamente o estado
 * em que ela deve funcionar (ADR-024).
 *
 * Só tokens do Carbono/Claro (DESIGN.md §4); nenhuma cor absoluta.
 */
export function ClientsShell({ tenant, title, subtitle, actions, children }: Props) {
  const { theme, toggle } = useTheme();

  return (
    <div className="flex h-screen bg-bg">
      <GlobalNav tenant={tenant} />

      <main className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between border-b border-border px-7 py-3.5">
          <span className="font-mono text-[11px] uppercase tracking-[0.1em] text-dim">
            ProPlan <span className="px-1 text-dimmer">/</span>
            <span className="text-text2">{title}</span>
          </span>
          <button
            onClick={toggle}
            aria-label="Alternar tema"
            className="rounded-[7px] border border-border2 px-2.5 py-1 text-[11px] text-body transition-colors hover:bg-card hover:text-text"
          >
            {theme === 'carbono' ? 'Claro' : 'Carbono'}
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-7 py-8">
          <div className="mx-auto max-w-[980px]">
            <div className="mb-6 flex items-start justify-between gap-4">
              <div>
                <h1 className="m-0 text-[23px] font-semibold text-text">{title}</h1>
                <p className="mt-1.5 text-[13.5px] text-body">{subtitle}</p>
              </div>
              {actions}
            </div>
            {children}
          </div>
        </div>
      </main>
    </div>
  );
}
