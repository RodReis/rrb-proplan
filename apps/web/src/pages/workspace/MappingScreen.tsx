import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { api, Entity, MappingRow } from '../../lib/api';

const LABELS: Record<Entity, string> = {
  architecture: 'Arquitetura',
  decisions: 'Decisões',
  design: 'Design',
  testing: 'Testes',
  deploy: 'Deploy',
  skills: 'Skills & Agentes',
};
const SOURCE_BADGE: Record<string, string> = {
  convention: 'convenção',
  alias: 'reconhecido por nome',
  config: 'manual',
  absent: 'ausente',
};

interface Props {
  projectId: string;
  focusEntity: Entity | null;
  onClose: () => void;
  onSaved: () => void;
}

/** Overlay de mapeamento manual das 6 entidades (Fatia 6, ADR-014). */
export function MappingScreen({ projectId, focusEntity, onClose, onSaved }: Props) {
  const [rows, setRows] = useState<MappingRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<Entity | null>(null);

  useEffect(() => {
    let active = true;
    api
      .mapping(projectId)
      .then((r) => active && setRows(r))
      .catch((e) => active && toast.error(`Falha ao carregar mapeamento: ${e}`))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [projectId]);

  async function save(entity: Entity, path: string | null) {
    setSaving(entity);
    const toastId = toast.loading('Salvando no repo…');
    try {
      await api.putMapping(projectId, entity, path);
      toast.success('Mapeamento salvo — re-sincronizando.', { id: toastId });
      onSaved();
    } catch (e) {
      toast.error(`Falha ao salvar: ${e}`, { id: toastId });
    } finally {
      setSaving(null);
    }
  }

  const resolved = rows.filter((r) => r.resolution.level !== 4).length;

  return (
    <div className="absolute inset-0 z-30 flex flex-col bg-surface">
      <header className="flex items-center justify-between border-b border-border px-8 py-4">
        <div>
          <h2 className="text-lg font-semibold">Mapeamento de documentos</h2>
          <p className="text-xs text-text-muted">
            {resolved} de {rows.length} resolvidas · {rows.length - resolved} ausentes
          </p>
        </div>
        <button
          onClick={onClose}
          className="rounded-md border border-border px-3 py-1.5 text-xs hover:border-brand"
        >
          Fechar
        </button>
      </header>
      <div className="min-h-0 flex-1 overflow-auto p-8">
        {loading ? (
          <div className="h-40 animate-pulse rounded-md bg-border/50" />
        ) : (
          <ul className="space-y-4">
            {rows.map((r) => (
              <li
                key={r.entity}
                className={
                  'rounded-lg border p-4 ' +
                  (focusEntity === r.entity ? 'border-brand' : 'border-border')
                }
              >
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">{LABELS[r.entity]}</span>
                  <span className="rounded-full bg-bg px-2 py-0.5 text-xs text-text-muted">
                    {SOURCE_BADGE[r.resolution.source]}
                  </span>
                </div>
                <div className="mt-1 font-mono text-xs text-text-muted">
                  {r.resolution.path ?? (r.resolution.paths.length ? r.resolution.paths.join(', ') : '—')}
                </div>
                <div className="mt-3 flex items-center gap-2">
                  <select
                    className="rounded-md border border-border bg-bg px-2 py-1 text-xs"
                    defaultValue={r.resolution.path ?? ''}
                    disabled={saving === r.entity}
                    onChange={(e) => save(r.entity, e.target.value || null)}
                  >
                    <option value="">(marcar ausente)</option>
                    {r.candidates.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                  {saving === r.entity && <span className="text-xs text-text-muted">salvando…</span>}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
