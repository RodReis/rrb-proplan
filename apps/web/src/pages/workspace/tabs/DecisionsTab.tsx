import { useEffect, useState } from 'react';
import { api, DecisionItem, TabSource } from '../../../lib/api';
import { TabFrame } from '../TabFrame';
import { DocViewerPanel } from '../DocViewerPanel';

interface Props {
  projectId: string;
  syncNonce: number;
  onCorrect: () => void;
}

export function DecisionsTab({ projectId, syncNonce, onCorrect }: Props) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [source, setSource] = useState<TabSource | null>(null);
  const [items, setItems] = useState<DecisionItem[]>([]);
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    api
      .tab<{ items: DecisionItem[] }>(projectId, 'decisions')
      .then((res) => {
        if (!active) return;
        setSource(res.source);
        setItems(res.payload?.items ?? []);
      })
      .catch((err) => active && setError(String(err)))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [projectId, syncNonce]);

  return (
    <TabFrame loading={loading} error={error} source={source} label="Decisões" onCorrect={onCorrect}>
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
