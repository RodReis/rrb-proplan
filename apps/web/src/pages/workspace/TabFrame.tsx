import { ReactNode } from 'react';
import { TabSource } from '../../lib/api';
import { conventionPathOf } from './shell/conventionPath';
import { TabHero } from './shell/TabHero';

interface Props {
  loading: boolean;
  error: string | null;
  source: TabSource | null;
  /** Rótulo da entidade para os estados vazios (ex.: "Arquitetura"). */
  label: string;
  /** Id da aba (`tabs.ts`) — a faixa usa para ícone, descrição e convenção. */
  tabId: string;
  /** Spans citados pela IA que justificam a classificação nível 3 (ADR-012). */
  spans?: string[];
  /**
   * A entidade está ausente (nível 4) MAS há um fallback inferido pela IA no
   * payload (Arquitetura/Design). Quando true, não mostra o vazio "não
   * documentado" — os children trazem o conteúdo inferido + badge + promover.
   */
  inferred?: boolean;
  /**
   * Há conteúdo lateral a mostrar mesmo sem documento (SPEC-023: o bloco de
   * stack detectada). Diferente de `inferred`: o empty state CONTINUA — a aba
   * segue "não documentada" — e os children aparecem abaixo dele. Sem isto o
   * bloco sumiria justamente no repo sem ARCHITECTURE.md, onde ele mais informa.
   */
  extras?: boolean;
  /** Abre a tela de mapeamento focada nesta entidade. */
  onCorrect: () => void;
  children: ReactNode;
}

/** Estados uniformes das abas: skeleton, erro, aviso de fonte (alias/inferência), ausente. */
export function TabFrame({
  loading,
  error,
  source,
  label,
  tabId,
  spans,
  inferred,
  extras,
  onCorrect,
  children,
}: Props) {
  if (loading) return <div className="m-8 h-40 animate-pulse rounded-[14px] bg-card" />;
  if (error) return <p className="m-8 text-sm text-error">{error}</p>;

  // Sem documento: a faixa É o empty state da aba, nada abaixo (DESIGN.md §6).
  // Ausência é informação (ADR-014) — sem cor de erro, sem tom de falha.
  if (source && source.level === 4 && !inferred) {
    return (
      <div className="mx-auto max-w-[1060px] p-8">
        <TabHero tabId={tabId} title={label} awaiting={conventionPathOf(tabId) ?? undefined} />
        <div className="mt-4 flex items-center gap-3">
          <p className="text-xs text-muted">
            Nenhuma fonte para esta aba neste repositório — se ela existe com outro
            nome, aponte o caminho.
          </p>
          <button
            onClick={onCorrect}
            className="shrink-0 rounded-[10px] border border-border2 px-3 py-1.5 text-xs font-semibold text-body2 transition-colors duration-150 hover:border-hoverb hover:text-text"
          >
            Mapear fonte
          </button>
        </div>
        {extras && <div className="mt-6">{children}</div>}
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[1060px] p-8">
      <TabHero
        tabId={tabId}
        title={label}
        path={source?.path ?? source?.paths[0] ?? null}
      />

      {source?.source === 'alias' && (
        <p className="mb-4 mt-4 text-xs text-muted">
          Fonte: <span className="font-mono">{source.path ?? source.paths[0]}</span>{' '}
          (reconhecido por nome —{' '}
          <button onClick={onCorrect} className="underline hover:text-text">
            corrigir
          </button>
          )
        </p>
      )}
      {source?.source === 'inference' && (
        <div
          className="mb-4 mt-4 rounded-[10px] border p-3 text-xs"
          style={{
            borderColor: 'var(--accentBorder)',
            backgroundColor: 'var(--accentSoft)',
          }}
        >
          {/* Chip de IA: contorno accentBorder, texto accent (§6 — Chips/IA). */}
          <p className="font-medium text-accent">
            Inferido por IA — este documento foi classificado como {label.toLowerCase()}{' '}
            pelo conteúdo.
          </p>
          {spans && spans.length > 0 && (
            <ul className="mt-2 space-y-1 text-muted">
              {spans.map((s, i) => (
                <li
                  key={i}
                  className="border-l-2 pl-2 italic"
                  style={{ borderColor: 'var(--accentBorder)' }}
                >
                  “{s}”
                </li>
              ))}
            </ul>
          )}
          <button
            onClick={onCorrect}
            aria-label={`Corrigir classificação de ${label}`}
            className="mt-2 text-accent underline"
          >
            não é isso — corrigir
          </button>
        </div>
      )}
      <div className="mt-6">{children}</div>
    </div>
  );
}
