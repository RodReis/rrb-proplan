import { ReactNode } from 'react';
import { TabSource } from '../../lib/api';

interface Props {
  loading: boolean;
  error: string | null;
  source: TabSource | null;
  /** Rótulo da entidade para os estados vazios (ex.: "Arquitetura"). */
  label: string;
  /** Spans citados pela IA que justificam a classificação nível 3 (ADR-012). */
  spans?: string[];
  /** Abre a tela de mapeamento focada nesta entidade. */
  onCorrect: () => void;
  children: ReactNode;
}

/** Estados uniformes das abas: skeleton, erro, aviso de fonte (alias/inferência), ausente. */
export function TabFrame({ loading, error, source, label, spans, onCorrect, children }: Props) {
  if (loading) return <div className="m-8 h-40 animate-pulse rounded-md bg-border/50" />;
  if (error) return <p className="m-8 text-sm text-error">{error}</p>;

  if (source && source.level === 4) {
    return (
      <div className="m-8 rounded-lg border border-dashed border-border p-8 text-center">
        <p className="text-sm font-medium">{label} não documentado</p>
        <p className="mt-1 text-xs text-text-muted">
          Nenhuma fonte para esta aba neste repositório.
        </p>
        <button
          onClick={onCorrect}
          className="mt-3 rounded-md border border-border px-3 py-1.5 text-xs hover:border-brand hover:text-brand"
        >
          Mapear fonte
        </button>
      </div>
    );
  }

  return (
    <div className="p-8">
      {source?.source === 'alias' && (
        <p className="mb-4 text-xs text-text-muted">
          Fonte: <span className="font-mono">{source.path ?? source.paths[0]}</span>{' '}
          (reconhecido por nome —{' '}
          <button onClick={onCorrect} className="underline hover:text-brand">
            corrigir
          </button>
          )
        </p>
      )}
      {source?.source === 'inference' && (
        <div
          className="mb-4 rounded-md border p-3 text-xs"
          style={{ borderColor: 'var(--color-warning)', backgroundColor: 'color-mix(in oklab, var(--color-warning) 8%, transparent)' }}
        >
          <p className="font-medium" style={{ color: 'var(--color-warning)' }}>
            Inferido por IA — este documento foi classificado como {label.toLowerCase()} pelo conteúdo.
          </p>
          {spans && spans.length > 0 && (
            <ul className="mt-2 space-y-1 text-text-muted">
              {spans.map((s, i) => (
                <li key={i} className="border-l-2 pl-2 italic" style={{ borderColor: 'var(--color-warning)' }}>
                  “{s}”
                </li>
              ))}
            </ul>
          )}
          <button
            onClick={onCorrect}
            aria-label={`Corrigir classificação de ${label}`}
            className="mt-2 underline hover:text-brand focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand"
          >
            não é isso — corrigir
          </button>
        </div>
      )}
      {children}
    </div>
  );
}
