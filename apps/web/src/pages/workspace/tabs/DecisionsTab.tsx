import { useEffect, useState } from 'react';
import { api, DecisionItem, InferencePayload, TabSource } from '../../../lib/api';
import { TabFrame } from '../TabFrame';
import { DocViewerPanel } from '../DocViewerPanel';

type Payload = { items: DecisionItem[] } & Partial<InferencePayload>;
interface Props {
  projectId: string;
  syncNonce: number;
  onCorrect: () => void;
}

export function DecisionsTab({ projectId, syncNonce, onCorrect }: Props) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [source, setSource] = useState<TabSource | null>(null);
  const [payload, setPayload] = useState<Payload | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    api
      .tab<Payload>(projectId, 'decisions')
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

  const items = payload?.items ?? [];

  return (
    <TabFrame loading={loading} error={error} source={source} label="Decisões" spans={payload?.spans} onCorrect={onCorrect}>
      <ul className="space-y-2">
        {items.map((it, i) => (
          <li key={`${it.path}-${i}`}>
            <button
              onClick={() => setOpen(it.path)}
              className="w-full rounded-md border border-border px-4 py-3 text-left hover:border-brand"
            >
              <div className="text-sm font-medium">{it.title}</div>
              <div className="mt-0.5 text-xs text-text-muted">
                {[it.status, it.date].filter(Boolean).join(' · ') || it.path}
              </div>
            </button>
          </li>
        ))}
      </ul>
      {open && <DocViewerPanel projectId={projectId} path={open} onClose={() => setOpen(null)} />}
    </TabFrame>
  );
}
