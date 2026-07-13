import { useEffect, useState } from 'react';
import { api, InferencePayload, TabSource, WorkflowInfo } from '../../../lib/api';
import { MarkdownView } from '../MarkdownView';
import { TabFrame } from '../TabFrame';

type Payload =
  | ({ markdown: string } & Partial<InferencePayload>)
  | { ci: { workflows: WorkflowInfo[] }; inferred: true };
interface Props {
  projectId: string;
  syncNonce: number;
  onCorrect: () => void;
}

export function TestsTab({ projectId, syncNonce, onCorrect }: Props) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [source, setSource] = useState<TabSource | null>(null);
  const [payload, setPayload] = useState<Payload | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    api
      .tab<Payload>(projectId, 'testing')
      .then((res) => {
        if (!active) return;
        setSource(res.source);
        setPayload(res.payload);
      })
      .catch((err) => active && setError(String(err)))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [projectId, syncNonce]);

  const isCi = payload !== null && 'ci' in payload;
  const spans = payload && 'markdown' in payload ? payload.spans : undefined;

  return (
    // fallback de CI: level=4 mas há payload — source=null evita o empty state indevido no TabFrame
    <TabFrame loading={loading} error={error} source={isCi ? null : source} label="Testes" spans={spans} onCorrect={onCorrect}>
      {payload && 'markdown' in payload && <MarkdownView markdown={payload.markdown} />}
      {payload && 'ci' in payload && (
        <div>
          <p className="mb-4 text-xs text-text-muted">Inferido do CI (nenhum doc de testes encontrado).</p>
          <ul className="space-y-3">
            {payload.ci.workflows.map((wf) => (
              <li key={wf.file} className="rounded-md border border-border p-4">
                <div className="text-sm font-medium">{wf.name}</div>
                <div className="mt-1 text-xs text-text-muted">Gatilhos: {wf.triggers.join(', ') || '—'}</div>
                <div className="mt-1 text-xs text-text-muted">
                  Jobs: {wf.jobs.map((j) => `${j.name}${j.runsOn ? ` (${j.runsOn})` : ''}`).join(', ') || '—'}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </TabFrame>
  );
}
