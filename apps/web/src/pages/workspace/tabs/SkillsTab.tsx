import { useEffect, useState } from 'react';
import { api, InferencePayload, SkillEntry, TabSource } from '../../../lib/api';
import { TabFrame } from '../TabFrame';

type Payload = { skills: SkillEntry[]; agents: SkillEntry[] } & Partial<InferencePayload>;

interface Props {
  projectId: string;
  syncNonce: number;
  onCorrect: () => void;
}

function Group({ title, entries }: { title: string; entries: SkillEntry[] }) {
  if (entries.length === 0) return null;
  return (
    <section className="mb-6">
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-muted">{title}</h3>
      <ul className="space-y-2">
        {entries.map((e) => (
          <li key={e.path} className="rounded-md border border-border p-3">
            <div className="text-sm font-medium">{e.name}</div>
            {e.description && <div className="mt-0.5 text-xs text-text-muted">{e.description}</div>}
          </li>
        ))}
      </ul>
    </section>
  );
}

export function SkillsTab({ projectId, syncNonce, onCorrect }: Props) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [source, setSource] = useState<TabSource | null>(null);
  const [payload, setPayload] = useState<Payload | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    api
      .tab<Payload>(projectId, 'skills')
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

  const data = payload ?? { skills: [], agents: [] };
  const empty = data.skills.length === 0 && data.agents.length === 0;

  return (
    <TabFrame loading={loading} error={error} source={source} label="Skills & Agentes" tabId="skills" spans={payload?.spans} onCorrect={onCorrect}>
      {empty ? (
        <p className="text-sm text-text-muted">Nenhuma skill ou agente configurado neste repositório.</p>
      ) : (
        <>
          <Group title="Skills" entries={data.skills} />
          <Group title="Agentes" entries={data.agents} />
        </>
      )}
    </TabFrame>
  );
}
