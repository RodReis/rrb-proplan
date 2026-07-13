import { useEffect, useState } from 'react';
import { api, InferencePayload, TabSource } from '../../../lib/api';
import { MarkdownView } from '../MarkdownView';
import { TabFrame } from '../TabFrame';

type Payload = { markdown: string } & Partial<InferencePayload>;
interface Props {
  projectId: string;
  syncNonce: number;
  onCorrect: () => void;
}

export function ArchitectureTab({ projectId, syncNonce, onCorrect }: Props) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [source, setSource] = useState<TabSource | null>(null);
  const [payload, setPayload] = useState<Payload | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    api
      .tab<Payload>(projectId, 'architecture')
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
    <TabFrame loading={loading} error={error} source={source} label="Arquitetura" spans={payload?.spans} onCorrect={onCorrect}>
      <MarkdownView markdown={payload?.markdown ?? ''} />
    </TabFrame>
  );
}
