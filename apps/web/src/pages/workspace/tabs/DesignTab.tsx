import { useEffect, useState } from 'react';
import { api, InferencePayload, TabSource } from '../../../lib/api';
import { MarkdownView } from '../MarkdownView';
import { PromoteDialog } from '../PromoteDialog';
import { TabFrame } from '../TabFrame';

type Payload = { markdown: string } & Partial<InferencePayload>;
interface Props {
  projectId: string;
  syncNonce: number;
  onCorrect: () => void;
}

export function DesignTab({ projectId, syncNonce, onCorrect }: Props) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [source, setSource] = useState<TabSource | null>(null);
  const [payload, setPayload] = useState<Payload | null>(null);
  const [promoteOpen, setPromoteOpen] = useState(false);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    api
      .tab<Payload>(projectId, 'design')
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

  return (
    <TabFrame loading={loading} error={error} source={source} label="Design" spans={payload?.spans} inferred={payload?.inferred === true} onCorrect={onCorrect}>
      {payload?.inferred === true && (
        <div
          className="mb-4 flex items-center justify-between rounded-md border p-3 text-xs"
          style={{ borderColor: 'var(--color-warning)', backgroundColor: 'color-mix(in oklab, var(--color-warning) 8%, transparent)' }}
        >
          <p style={{ color: 'var(--color-warning)' }}>
            inferido por IA — este conteúdo foi gerado a partir da documentação; promova a um documento real para torná-lo fonte
          </p>
          <button
            onClick={() => setPromoteOpen(true)}
            aria-label="Promover conteúdo inferido a documento"
            className="ml-3 shrink-0 rounded-md border border-border bg-surface px-2.5 py-1 font-semibold hover:border-brand hover:text-brand focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand"
          >
            Promover a documento
          </button>
        </div>
      )}
      <MarkdownView markdown={payload?.markdown ?? ''} />
      {promoteOpen && (
        <PromoteDialog
          projectId={projectId}
          tab="design"
          initialContent={payload?.markdown ?? ''}
          onClose={() => setPromoteOpen(false)}
          onPromoted={() => setPromoteOpen(false)}
        />
      )}
    </TabFrame>
  );
}
