import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { useTheme } from '../theme';
import heroCarbono from '../assets/hero-grafo.jpg';
import heroClaro from '../assets/hero-grafo-claro.png';

/** As mensagens de valor do hero (SPEC-021 §1) — em linguagem de negócio. */
const FEATURES = [
  {
    title: 'Transparência contínua',
    desc: 'Acompanhe o andamento a qualquer momento, em linguagem de negócio — sem esperar a próxima reunião de status.',
  },
  {
    title: 'Entregas com validação formal',
    desc: 'O quadro separa “Feito” de “Finalizado”: cada entrega passa pelo seu aceite. O “terminei” sem validação deixa de existir.',
  },
  {
    title: 'Menos dependência de pessoas',
    desc: 'O conhecimento do projeto fica registrado e organizado no repositório — não na memória de um desenvolvedor.',
  },
  {
    title: 'Alerta antes do prejuízo',
    desc: 'Documentação defasada e projetos à deriva são sinalizados cedo, quando ainda é barato corrigir.',
  },
];

const ROTATE_MS = 4500;

/**
 * Login (SPEC-021 §1): 2 colunas — hero de valor + painel de ação.
 *
 * Pré-autenticação: o tema vem do localStorage (padrão Carbono) e o toggle
 * funciona aqui também — quem nunca entrou ainda escolhe como quer ver.
 * O fluxo OAuth é o mesmo de antes; muda só a apresentação.
 */
export function Login() {
  const { theme, toggle } = useTheme();
  const dark = theme === 'carbono';
  const [idx, setIdx] = useState(0);
  // Rotação pausa quando o usuário escolhe um item: mexer no controle é dizer
  // "eu dirijo agora" — retomar por cima seria roubar o volante.
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    if (paused) return;
    const t = setInterval(() => setIdx((i) => (i + 1) % FEATURES.length), ROTATE_MS);
    return () => clearInterval(t);
  }, [paused]);

  const hero = dark ? heroCarbono : heroClaro;
  // Gradiente de leitura por tema (§10): carbono escurece, claro clareia.
  const heroOverlay = dark
    ? 'linear-gradient(180deg, rgba(12,13,15,.25), transparent 30%, transparent 70%, rgba(12,13,15,.45))'
    : 'linear-gradient(180deg, rgba(242,242,240,.2), transparent 30%, transparent 70%, rgba(242,242,240,.35))';

  const feature = FEATURES[idx];

  return (
    <div className="relative grid min-h-screen grid-cols-1 bg-bg text-text lg:grid-cols-[1fr_460px]">
      <button
        onClick={toggle}
        title={dark ? 'Mudar para o tema Claro' : 'Mudar para o tema Carbono'}
        aria-label={dark ? 'Mudar para o tema Claro' : 'Mudar para o tema Carbono'}
        className="absolute right-[18px] top-[18px] z-20 flex h-9 w-9 items-center justify-center rounded-[10px] border border-border2 bg-surface text-muted transition-colors duration-150 hover:border-hoverb hover:text-text"
      >
        <ThemeIcon dark={dark} />
      </button>

      {/* Coluna visual — escondida no estreito: o hero é reforço, a ação é o
          que não pode faltar. */}
      <section className="relative hidden flex-col overflow-hidden lg:flex">
        <div className="relative max-w-[640px] px-16 pt-14">
          <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-faint">
            Transparência e governança
          </span>
          <h2 className="mt-3.5 text-[34px] font-semibold leading-[1.2] tracking-[-0.02em] text-balance">
            Veja em que pé o seu projeto está — sem depender de reunião de status.
          </h2>
        </div>

        <div className="relative mx-11 mt-5 min-h-[320px] flex-1 overflow-hidden rounded-[18px] border border-border">
          <div
            role="img"
            aria-label="Grafo de documentos do projeto"
            className="anim-heroZoom absolute inset-0 bg-cover"
            style={{ backgroundImage: `url(${hero})`, backgroundPosition: 'center 45%' }}
          />
          <div aria-hidden className="absolute inset-0" style={{ background: heroOverlay }} />

          <FloatingCard className="left-5 top-[18px]">
            <span
              aria-hidden
              className="anim-pulse h-[7px] w-[7px] rounded-full"
              style={{ background: 'var(--accent)' }}
            />
            <span className="text-[11.5px] text-body2">
              Docs × código: <strong className="font-semibold text-text">sem divergência</strong>
            </span>
          </FloatingCard>

          <FloatingCard className="bottom-[18px] right-5">
            <svg
              aria-hidden
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.4"
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{ color: 'var(--success)' }}
            >
              <path d="M20 6 9 17l-5-5" />
            </svg>
            <span className="text-[11.5px] text-body2">
              Aceite: <strong className="font-semibold text-text">sempre humano</strong>
            </span>
          </FloatingCard>
        </div>

        {/* Mensagens de valor. O carrossel gira sozinho — exceção ao §9
            (movimento em loop parado), aprovada pelo PI em 2026-07-16 e
            registrada no DESIGN.md; para sob prefers-reduced-motion. */}
        <div className="relative max-w-[560px] px-16 pb-12">
          <div className="min-h-[96px] border-t border-border pt-6">
            <div className="mb-2 flex items-center gap-2.5">
              <span className="font-mono text-[11px] tracking-[0.14em] text-faint">
                {`0${idx + 1} / 0${FEATURES.length}`}
              </span>
              <span className="text-[15px] font-semibold text-text">{feature.title}</span>
            </div>
            <p className="m-0 text-[13.5px] leading-relaxed text-muted text-pretty">
              {feature.desc}
            </p>
          </div>
          <div className="mt-[18px] flex gap-2">
            {FEATURES.map((f, k) => (
              <button
                key={f.title}
                onClick={() => {
                  setIdx(k);
                  setPaused(true);
                }}
                aria-label={`Ver: ${f.title}`}
                aria-current={k === idx}
                className="h-1 rounded-full transition-all duration-300"
                style={{
                  width: k === idx ? 28 : 12,
                  background: k === idx ? 'var(--accent)' : 'var(--border3)',
                }}
              />
            ))}
          </div>
        </div>
      </section>

      {/* Coluna de ação */}
      <section className="flex flex-col border-l border-border bg-panel px-12 py-11">
        <div className="flex items-center gap-3">
          <span
            aria-hidden
            className="flex h-[38px] w-[38px] items-center justify-center rounded-[10px] text-lg font-bold"
            style={{ background: 'var(--brand-gradient)', color: 'var(--brand-fg)' }}
          >
            P
          </span>
          <span className="flex flex-col">
            <span className="text-base font-semibold tracking-[-0.01em]">ProPlan</span>
            <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-faint">
              Governança de projetos
            </span>
          </span>
        </div>

        <div className="flex max-w-[340px] flex-1 flex-col justify-center">
          <h1 className="mb-2.5 text-[28px] font-semibold tracking-[-0.02em]">
            Entrar no painel
          </h1>
          <p className="mb-8 text-sm leading-relaxed text-muted">
            Acompanhe seus projetos com estado visível, entregas validadas por você e
            conhecimento registrado.
          </p>

          <a
            href={api.loginUrl}
            className="flex h-12 items-center justify-center gap-2.5 rounded-[10px] bg-btnbg text-sm font-semibold text-btnfg transition-[filter] duration-150 hover:brightness-110"
          >
            <GithubIcon />
            Entrar com GitHub
          </a>

          <div className="mt-5 flex items-start gap-2.5 rounded-[10px] border border-border2 bg-surface px-4 py-3.5">
            <svg
              aria-hidden
              width="15"
              height="15"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              className="mt-px shrink-0 text-accent"
            >
              <rect x="5" y="11" width="14" height="9" rx="2" />
              <path d="M8 11V7a4 4 0 0 1 8 0v4" />
            </svg>
            <span className="text-[12.5px] leading-[1.55] text-muted">
              Somente leitura de documentação — o ProPlan{' '}
              <strong className="font-semibold text-body2">nunca clona seu código</strong>. A
              fonte de verdade continua sendo o seu repositório.
            </span>
          </div>

          <div className="mt-8 flex flex-col gap-3">
            <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-dim">
              Três princípios
            </span>
            {[
              'O aceite é sempre humano',
              'IA identificada e revisável',
              'Seus dados continuam seus',
            ].map((p) => (
              <div key={p} className="flex items-center gap-2.5 text-[13px] text-body2">
                <span
                  aria-hidden
                  className="h-[5px] w-[5px] shrink-0 rounded-full"
                  style={{ background: 'var(--accent)' }}
                />
                {p}
              </div>
            ))}
          </div>
        </div>

        <div className="text-xs text-dim">
          Rodrigo Reis ·{' '}
          <a href="mailto:rodreisdev@gmail.com" className="text-muted hover:text-text">
            rodreisdev@gmail.com
          </a>
        </div>
      </section>
    </div>
  );
}

/**
 * Cartão de vidro flutuante sobre o hero.
 *
 * O vidro precisa de opacidade alta para o texto sobreviver à imagem por baixo
 * — no claro ainda mais, porque a `hero-grafo-claro` é quase branca. Daí 92%
 * no claro contra 72% no carbono, e não um valor só.
 */
function FloatingCard({
  className,
  children,
}: {
  className: string;
  children: React.ReactNode;
}) {
  const { theme } = useTheme();
  const opacity = theme === 'carbono' ? '72%' : '92%';
  return (
    <div
      className={
        'absolute flex items-center gap-2.5 rounded-[11px] border px-3.5 py-2.5 backdrop-blur-md ' +
        className
      }
      style={{
        background: `color-mix(in srgb, var(--pop) ${opacity}, transparent)`,
        borderColor: 'var(--accentBorder)',
      }}
    >
      {children}
    </div>
  );
}

function ThemeIcon({ dark }: { dark: boolean }) {
  return (
    <svg
      aria-hidden
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {dark ? (
        <>
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
        </>
      ) : (
        <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8" />
      )}
    </svg>
  );
}

function GithubIcon() {
  return (
    <svg viewBox="0 0 16 16" width="18" height="18" fill="currentColor" aria-hidden>
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82a7.5 7.5 0 0 1 4 0c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
    </svg>
  );
}
