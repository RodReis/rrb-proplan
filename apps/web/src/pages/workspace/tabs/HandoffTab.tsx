import { useEffect, useState } from 'react';
import {
  api,
  Handoff,
  HandoffBlock,
  HandoffConfidenceMath,
} from '../../../lib/api';

interface Props {
  projectId: string;
  syncNonce: number;
}

/**
 * Aba Handoff (SPEC-018, Fatia 13.5): preview do instantâneo exportável +
 * download + write-back em `.proplan/HANDOFF.md`. Cada bloco imprime confiança
 * e "a conta" (clicável, `<details>`); bloco recusado aparece explícito ("não
 * sei"), nunca some. O cabeçalho de validade avisa que é uma foto.
 */
export function HandoffTab({ projectId, syncNonce }: Props) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [handoff, setHandoff] = useState<Handoff | null>(null);
  const [markdown, setMarkdown] = useState<string>('');
  const [committing, setCommitting] = useState(false);
  const [commitMsg, setCommitMsg] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    setCommitMsg(null);
    api
      .handoff(projectId)
      .then((res) => {
        if (!active) return;
        setHandoff(res.structure);
        setMarkdown(res.markdown);
      })
      .catch((err) => active && setError(String(err)))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [projectId, syncNonce]);

  function handleDownload() {
    const blob = new Blob([markdown], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'HANDOFF.md';
    a.click();
    URL.revokeObjectURL(url);
  }

  async function handleCommit() {
    setCommitting(true);
    setCommitMsg(null);
    try {
      const { committed } = await api.commitHandoff(projectId);
      setCommitMsg(
        committed
          ? 'Handoff commitado em .proplan/HANDOFF.md.'
          : 'Não foi possível commitar — o download acima continua válido.',
      );
    } catch (err) {
      setCommitMsg(`Falha ao commitar: ${String(err)}`);
    } finally {
      setCommitting(false);
    }
  }

  if (loading) return <div className="m-8 h-40 animate-pulse rounded-md bg-border/50" />;
  if (error) return <p className="m-8 text-sm text-error">{error}</p>;
  if (!handoff) return null;

  return (
    <div className="m-8 max-w-3xl">
      <header className="mb-6 rounded-lg border border-border bg-surface/50 p-4">
        <p className="text-sm font-medium">Instantâneo de contexto — para levar embora</p>
        <p className="mt-1 text-xs text-text-muted">
          gerado em {handoff.header.generatedAt} · docsScopeHash{' '}
          <code className="rounded bg-border/40 px-1 py-0.5">
            {handoff.header.docsScopeHash || '—'}
          </code>
        </p>
        <p className="mt-1 text-xs text-warning">{handoff.header.notice}</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            onClick={handleDownload}
            className="rounded-md bg-brand px-3 py-1.5 text-xs font-medium text-white hover:opacity-90"
          >
            Baixar HANDOFF.md
          </button>
          <button
            onClick={handleCommit}
            disabled={committing}
            className="rounded-md border border-border px-3 py-1.5 text-xs hover:border-brand hover:text-brand disabled:opacity-50"
          >
            {committing ? 'Commitando…' : 'Commitar em .proplan/'}
          </button>
        </div>
        {commitMsg && <p className="mt-2 text-xs text-text-muted">{commitMsg}</p>}
      </header>

      <div className="space-y-4">
        {handoff.blocks.map((block) => (
          <Block key={block.key} block={block} />
        ))}
      </div>
    </div>
  );
}

function Block({ block }: { block: HandoffBlock }) {
  const refused = block.body.refused;
  return (
    <section
      className={
        'rounded-lg border p-4 ' +
        (refused ? 'border-warning/40 bg-warning/5' : 'border-border')
      }
    >
      <h3 className="text-sm font-medium">{block.title}</h3>
      {refused ? (
        <p className="mt-2 text-sm text-warning">
          não sei — ausente/defasado · falta: {describeMissing(block.body.missing)}
        </p>
      ) : (
        <>
          <p className="mt-2 whitespace-pre-wrap text-sm text-text">{block.body.value}</p>
          {block.refs && block.refs.length > 0 && (
            <ul className="mt-2 space-y-1 text-sm">
              {block.refs.map((r) => (
                <li key={r.number}>
                  <a
                    href={r.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-brand hover:underline"
                  >
                    #{r.number}
                  </a>{' '}
                  — {r.title}{' '}
                  <span className="text-xs text-text-muted">
                    (rótulo em {r.capturedAt}; estado vivo no GitHub)
                  </span>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-2 text-xs text-text-muted">{block.body.provenance}</p>
        </>
      )}
      <ConfidenceDetail confidence={block.body.confidence} math={block.body.math} />
    </section>
  );
}

/** Confiança + "a conta" clicável (`<details>` nativo — sem lib de popover). */
function ConfidenceDetail({
  confidence,
  math,
}: {
  confidence: number;
  math: HandoffConfidenceMath;
}) {
  return (
    <details className="mt-2">
      <summary className="cursor-pointer text-xs text-text-muted">
        confiança {Math.round(confidence * 100)}% · a conta
      </summary>
      <dl className="mt-1 grid grid-cols-2 gap-x-4 gap-y-0.5 text-xs text-text-muted">
        <dt>staleness</dt>
        <dd>{math.stalenessDays}d</dd>
        <dt>cobertura</dt>
        <dd>{math.cobertura}</dd>
        <dt>contradição</dt>
        <dd>{math.contradicao}</dd>
        <dt>drift</dt>
        <dd>{math.drift}</dd>
      </dl>
    </details>
  );
}

function describeMissing(missing: unknown): string {
  if (!missing) return 'confirmação da fonte';
  if (typeof missing === 'string') return missing;
  if (typeof missing === 'object') {
    const m = missing as Record<string, unknown>;
    if (typeof m.note === 'string') return m.note;
    if (typeof m.path === 'string') return m.path;
    if (Array.isArray(m.paths) && m.paths.length) return m.paths.join(', ');
    if (typeof m.entity === 'string') return `documento de ${m.entity}`;
  }
  return JSON.stringify(missing);
}
