import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { api, Entity, MappingRow } from '../../lib/api';
import { OperationSteps, useOperation } from './OperationSteps';

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
  inference: 'inferido por IA',
  absent: 'ausente',
};

/**
 * Estado de uma resolução, para a UI (CONVENTION.md + ADR-014): os três são
 * distintos e a tela precisa distingui-los —
 * - `file`: arquivo único (`path` set) → editável pelo `<select>`.
 * - `collection`: diretório/coleção (`path` null, `paths` não vazio, ex.: `adr/`,
 *   `.claude/skills/`) → resolvida e populada; NÃO é opção de `<select>` de
 *   arquivo único e se ajusta no `.proplan/config.yml`, não aqui.
 * - `absent`: nada resolve (`path` null, `paths` vazio) → "(marcar ausente)".
 */
type ResolutionKind = 'file' | 'collection' | 'absent';
function resolutionKind(r: MappingRow['resolution']): ResolutionKind {
  if (r.path) return 'file';
  if (r.paths.length > 0) return 'collection';
  return 'absent';
}

interface Props {
  projectId: string;
  focusEntity: Entity | null;
  onClose: () => void;
  onSaved: () => void;
}

/** Overlay de mapeamento manual das 6 entidades (Fatia 6, ADR-014). */
export function MappingScreen({ projectId, focusEntity, onClose, onSaved }: Props) {
  const [rows, setRows] = useState<MappingRow[]>([]);
  const [proplanConfigInvalid, setProplanConfigInvalid] = useState(false);
  const [loading, setLoading] = useState(true);
  const [savingEntity, setSavingEntity] = useState<Entity | null>(null);
  const [operationId, setOperationId] = useState<string | null>(null);

  const op = useOperation(operationId, onSaved);

  useEffect(() => {
    let active = true;
    api
      .mapping(projectId)
      .then((r) => {
        if (!active) return;
        setRows(r.rows);
        setProplanConfigInvalid(r.proplanConfigInvalid);
      })
      .catch((e) => active && toast.error(`Falha ao carregar mapeamento: ${e}`))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [projectId]);

  async function save(entity: Entity, path: string | null) {
    setSavingEntity(entity);
    try {
      const { operationId } = await api.putMapping(projectId, entity, path);
      setOperationId(operationId);
    } catch (e) {
      toast.error(`Falha ao salvar: ${e}`);
      setSavingEntity(null);
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
        {proplanConfigInvalid && (
          <div className="mb-4 rounded-md border border-warning/30 bg-warning/5 px-4 py-3 text-sm text-text">
            Config do ProPlan inválida neste repositório — o mapeamento manual foi
            ignorado. Corrija o <code>.proplan/config.yml</code> no repo.
          </div>
        )}
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
                  {resolutionKind(r.resolution) === 'collection' ? (
                    // Coleção (diretório): resolvida e populada — não é escolha de
                    // arquivo único. Read-only aqui; ajusta-se no .proplan/config.yml.
                    <p className="text-xs text-text-muted">
                      <span className="font-medium text-text">Coleção</span> de{' '}
                      {r.resolution.paths.length} documento
                      {r.resolution.paths.length === 1 ? '' : 's'} — ajuste no{' '}
                      <code>.proplan/config.yml</code>.
                    </p>
                  ) : (
                    <select
                      className="rounded-md border border-border bg-bg px-2 py-1 text-xs"
                      value={r.resolution.path ?? ''}
                      disabled={operationId !== null}
                      onChange={(e) => save(r.entity, e.target.value || null)}
                    >
                      <option value="">(marcar ausente)</option>
                      {r.candidates.map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {op && (
        <div className="absolute inset-0 z-40 flex items-center justify-center bg-text/20 p-4">
          <div className="w-full max-w-lg rounded-lg border border-border bg-surface p-5">
            <h3 className="mb-3 text-sm font-semibold">
              Salvando o mapeamento de {savingEntity ? LABELS[savingEntity] : ''}
            </h3>
            <OperationSteps op={op} />
            {op.status === 'failed' && (
              <div className="mt-3 flex justify-end">
                <button
                  onClick={() => {
                    setOperationId(null);
                    setSavingEntity(null);
                  }}
                  className="rounded-md border border-border px-3 py-1.5 text-xs font-semibold hover:bg-bg"
                >
                  Fechar
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
