import { useEffect, useState } from 'react';
import { api, TabSource } from '../../../lib/api';
import { MarkdownView } from '../MarkdownView';
import { TabFrame } from '../TabFrame';

interface Props {
  projectId: string;
  syncNonce: number;
  onCorrect: () => void;
}

export function DesignTab({ projectId, syncNonce, onCorrect }: Props) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [source, setSource] = useState<TabSource | null>(null);
  const [markdown, setMarkdown] = useState('');

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    api
      .tab<{ markdown: string }>(projectId, 'design')
      .then((res) => {
        if (!active) return;
        setSource(res.source);
        setMarkdown(res.payload?.markdown ?? '');
      })
      .catch((err) => active && setError(String(err)))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [projectId, syncNonce]);

  return (
    <TabFrame loading={loading} error={error} source={source} label="Design" onCorrect={onCorrect}>
      <MarkdownView markdown={markdown} />
    </TabFrame>
  );
}
