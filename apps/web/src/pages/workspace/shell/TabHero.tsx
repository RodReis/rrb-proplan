import { useTheme } from '../../../theme';
import { TabIcon } from './TabIcon';
import vistaCarbono from '../../../assets/workspace-vista.png';
import vistaClaro from '../../../assets/workspace-vista-claro.png';

interface Props {
  tabId: string;
  title: string;
  /** Caminho do doc que alimenta a aba, quando existe. */
  path?: string | null;
  /** Quando o doc foi sincronizado do repositório. */
  syncedAt?: string | null;
  /**
   * Arquivo que a aba espera quando o doc **não** existe (ex.:
   * `docs/ARCHITECTURE.md`). Ausência é informação (ADR-014) — a faixa nunca usa
   * cor de erro.
   */
  awaiting?: string | null;
}

/**
 * Faixa de aba — hero das abas de documento (DESIGN.md §6).
 *
 * Com documento presente, antecede o conteúdo. Sem documento, a faixa **é** o
 * empty state da aba (nada abaixo).
 */
export function TabHero({ tabId, title, path, syncedAt, awaiting }: Props) {
  const { theme } = useTheme();
  // background-image vindo do estado do tema, nunca <img src> tardio (§10).
  const image = theme === 'carbono' ? vistaCarbono : vistaClaro;

  // Gradiente de leitura por tema: carbono escurece, claro clareia (§10).
  const scrim =
    theme === 'carbono'
      ? 'linear-gradient(180deg, color-mix(in srgb, var(--bg) 35%, transparent) 0%, var(--bg) 92%)'
      : 'linear-gradient(180deg, color-mix(in srgb, var(--bg) 25%, transparent) 0%, var(--bg) 92%)';

  const label = awaiting
    ? `Aguarda ${awaiting}`
    : `Sincronizado do repositório${syncedAt ? ` · ${formatWhen(syncedAt)}` : ''}`;

  return (
    <section className="relative overflow-hidden rounded-[18px] border border-border">
      <div className="relative h-[168px] overflow-hidden">
        <div
          aria-hidden
          className="anim-heroZoom absolute inset-0 bg-cover bg-center"
          style={{ backgroundImage: `url(${image})` }}
        />
        <div aria-hidden className="absolute inset-0" style={{ background: scrim }} />
      </div>

      <div className="relative -mt-9 px-6 pb-5">
        {/* Ícone-chip ancorado na base da imagem (§6). */}
        <span
          aria-hidden
          className="mb-3 flex h-10 w-10 items-center justify-center rounded-[10px] border border-border2 bg-card text-accent"
        >
          <TabIcon id={tabId} />
        </span>
        <h1 className="text-[22px] font-semibold tracking-[-0.01em] text-text">{title}</h1>
        <p className="mt-1.5 max-w-[62ch] text-[13px] leading-relaxed text-body">
          {DESCRIPTIONS[tabId] ?? 'Documentação sincronizada do repositório.'}
        </p>
        <p className="mt-3 font-mono text-[9px] uppercase tracking-[0.14em] text-faint">
          {label}
          {path && !awaiting && <span className="text-dim"> · {path}</span>}
        </p>
      </div>
    </section>
  );
}

/**
 * O que cada visão responde — para quem chega sem contexto (§6). Não é o resumo
 * do documento: é a pergunta que a aba existe para responder.
 */
const DESCRIPTIONS: Record<string, string> = {
  architecture:
    'Como o sistema é desenhado: módulos, fronteiras e por onde os dados passam. O mapa antes do código.',
  decisions:
    'As decisões estruturais que já foram tomadas — e por quê. Leia antes de propor mudança de arquitetura.',
  skills:
    'Os agentes e skills que atuam neste repositório, e o que cada um tem permissão de fazer.',
  tests:
    'O que é verificado por máquina e o que ainda não é. Evidência de teste, nunca narrativa.',
  design:
    'A linguagem visual do produto: tokens, componentes e as regras de comportamento que os regem.',
  deploy:
    'Onde este projeto roda, em quais ambientes, e se as fontes concordam sobre isso.',
  context:
    'O que um humano afirmou sobre este projeto que o código não conta — restrições, contexto e acordos.',
  handoff: 'O instantâneo que se leva embora: tudo que outra pessoa (ou agente) precisa para continuar.',
};

/** "há 2 h" / "ontem" / data — linguagem de gente, nunca timestamp cru (§7). */
function formatWhen(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms)) return 'recentemente';
  const h = Math.floor(ms / 3_600_000);
  if (h < 1) return 'há minutos';
  if (h < 24) return `há ${h} h`;
  const d = Math.floor(h / 24);
  if (d === 1) return 'ontem';
  if (d < 30) return `há ${d} dias`;
  return new Date(iso).toLocaleDateString('pt-BR');
}
