import { useEffect, useState } from 'react';
import { api, DeployEnv, TabSource } from '../../../lib/api';
import { TabFrame } from '../TabFrame';

interface Props {
  projectId: string;
  syncNonce: number;
  onCorrect: () => void;
}

export function DeployTab({ projectId, syncNonce, onCorrect }: Props) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [source, setSource] = useState<TabSource | null>(null);
  const [envs, setEnvs] = useState<DeployEnv[]>([]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    api
      .tab<{ environments: DeployEnv[] }>(projectId, 'deploy')
      .then((res) => {
        if (!active) return;
        setSource(res.source);
        setEnvs(res.payload?.environments ?? []);
      })
      .catch((err) => active && setError(String(err)))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [projectId, syncNonce]);

  const active = (s: string) => /ativo|active|produção|production/i.test(s);

  return (
    <TabFrame loading={loading} error={error} source={source} label="Deploy" onCorrect={onCorrect}>
      <table className="w-full text-sm">
        <thead className="text-left text-xs text-text-muted">
          <tr>
            <th className="pb-2">Ambiente</th>
            <th className="pb-2">Status</th>
            <th className="pb-2">Plataforma</th>
            <th className="pb-2">URL</th>
          </tr>
        </thead>
        <tbody>
          {envs.map((e) => (
            <tr key={e.env} className="border-t border-border">
              <td className="py-2 font-medium">{e.env}</td>
              <td className="py-2">
                <span
                  className={
                    'rounded-full px-2 py-0.5 text-xs ' +
                    (active(e.status) ? 'bg-success/10 text-success' : 'bg-border/50 text-text-muted')
                  }
                >
                  {e.status}
                </span>
              </td>
              <td className="py-2 text-text-muted">{e.platform}</td>
              <td className="py-2">
                {e.url ? (
                  <a href={e.url} target="_blank" rel="noopener noreferrer" className="text-brand hover:underline">
                    {e.url}
                  </a>
                ) : (
                  '—'
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </TabFrame>
  );
}
