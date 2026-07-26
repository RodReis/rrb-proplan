import type { ReactNode } from 'react';
import { useTheme } from '../../theme';
import { GlobalNav } from './GlobalNav';
import bannerCarbono from '../../assets/catalogo-banner.png';
import bannerClaro from '../../assets/catalogo-banner-claro.jpg';

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
  const dark = theme === 'carbono';
  const banner = dark ? bannerCarbono : bannerClaro;
  const bannerOverlay = dark
    ? 'linear-gradient(90deg, rgba(12,13,15,.9), rgba(12,13,15,.5) 55%, rgba(12,13,15,.15))'
    : 'linear-gradient(90deg, rgba(250,250,248,.92), rgba(250,250,248,.55) 55%, rgba(250,250,248,.15))';

  return (
    <div className="flex h-screen bg-bg max-[720px]:flex-col">
      <GlobalNav tenant={tenant} section={title} />

      <main className="flex min-h-0 min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between gap-3 border-b border-border px-7 py-3.5 max-[720px]:px-4">
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

        <div className="min-h-0 flex-1 overflow-y-auto px-7 py-5 max-[720px]:px-3 max-[720px]:py-3">
          <div className="mx-auto grid w-full max-w-[1480px] gap-4">
            <section className="relative flex min-h-[94px] items-center overflow-hidden rounded-[14px] border border-border">
              <div
                aria-hidden
                className="anim-heroZoom absolute inset-0 bg-cover"
                style={{ backgroundImage: `url(${banner})`, backgroundPosition: 'center 42%' }}
              />
              <div aria-hidden className="absolute inset-0" style={{ background: bannerOverlay }} />
              <div className="relative flex flex-1 items-center justify-between gap-4 px-5 py-4 max-[720px]:flex-col max-[720px]:items-start">
                <div className="min-w-0">
                  <h1 className="m-0 text-2xl font-semibold tracking-[-0.01em] text-text">{title}</h1>
                  <p className="mt-1 max-w-[680px] text-[13.5px] text-body">{subtitle}</p>
                </div>
                {actions && <div className="shrink-0 max-[720px]:w-full">{actions}</div>}
              </div>
            </section>
            {children}
          </div>
        </div>
      </main>
    </div>
  );
}
