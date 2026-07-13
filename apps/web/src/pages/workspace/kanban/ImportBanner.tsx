import { useState } from 'react';
import { toast } from 'sonner';
import { api, CardToCreate } from '../../../lib/api';
import { COLUMN_LABEL } from './columns';

interface Props {
  projectId: string;
  onImported: () => void;
  onBootstrap: () => void;
}

/**
 * Banner de importação (SPEC-005): projeto com docs/STATUS.md legado e sem
 * issues proplan:*. Oferece importar os cards do markdown como Issues (prévia
 * editável) ou gerar um backlog novo por IA. Nada é criado sem o usuário mandar.
 */
export function ImportBanner({ projectId, onImported, onBootstrap }: Props) {
  const [preview, setPreview] = useState<CardToCreate[] | null>(null);
  const [importing, setImporting] = useState(false);

  async function loadPreview() {
    try {
      setPreview(await api.previewImport(projectId));
    } catch (err) {
      toast.error(`Não foi possível ler o STATUS.md: ${err}`);
    }
  }

  function removeCard(index: number) {
    setPreview((prev) => prev?.filter((_, i) => i !== index) ?? null);
  }

  function editTitle(index: number, title: string) {
    setPreview((prev) =>
      prev?.map((c, i) => (i === index ? { ...c, title } : c)) ?? null,
    );
  }

  async function confirmImport() {
    if (!preview) return;
    setImporting(true);
    try {
      const { created } = await api.applyImport(projectId, preview);
      toast.success(`${created} issues criadas.`);
      setPreview(null);
      onImported();
    } catch (err) {
      toast.error(`Falha ao importar: ${err}`);
    } finally {
      setImporting(false);
    }
  }

  return (
    <div className="border-b border-warning/30 bg-warning/5 px-6 py-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-text">
          Este projeto tem um <strong>docs/STATUS.md legado</strong>. Importe os
          cards como Issues ou gere um backlog novo por IA.
        </p>
        <div className="flex gap-2">
          <button
            onClick={onBootstrap}
            className="rounded-md border border-border bg-surface px-3 py-1.5 text-xs font-semibold hover:border-brand hover:text-brand"
          >
            Gerar por IA
          </button>
          <button
            onClick={() => void loadPreview()}
            className="rounded-md border border-brand bg-brand px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90"
          >
            Importar do STATUS.md
          </button>
        </div>
      </div>

      {preview && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-text/20 p-4"
          onClick={() => setPreview(null)}
        >
          <div
            className="flex max-h-[80vh] w-full max-w-lg flex-col rounded-lg border border-border bg-surface"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="border-b border-border px-5 py-3">
              <h2 className="text-sm font-semibold">
                Importar {preview.length} cards como Issues
              </h2>
              <p className="mt-0.5 text-xs text-text-muted">
                Revise antes de criar. O docs/STATUS.md permanece no repo com um
                aviso de migração.
              </p>
            </div>
            <div className="min-h-0 flex-1 overflow-auto p-3">
              {preview.map((c, i) => (
                <div
                  key={i}
                  className="flex items-center gap-2 border-b border-border/50 px-2 py-1.5 text-sm last:border-0"
                >
                  <input
                    value={c.title}
                    onChange={(e) => editTitle(i, e.target.value)}
                    className="min-w-0 flex-1 bg-transparent outline-none focus:text-brand"
                  />
                  <span className="shrink-0 text-xs text-text-muted">
                    {COLUMN_LABEL[c.column]}
                    {c.priority ? ` · ${c.priority}` : ''}
                  </span>
                  <button
                    onClick={() => removeCard(i)}
                    title="Remover da importação"
                    className="shrink-0 text-text-muted hover:text-error"
                  >
                    ✕
                  </button>
                </div>
              ))}
              {preview.length === 0 && (
                <p className="py-6 text-center text-sm text-text-muted">
                  Nenhum card selecionado — remova todos ou cancele.
                </p>
              )}
            </div>
            <div className="flex justify-end gap-2 border-t border-border px-5 py-3">
              <button
                onClick={() => setPreview(null)}
                className="rounded-md border border-border px-3 py-1.5 text-xs font-semibold hover:bg-bg"
              >
                Cancelar
              </button>
              <button
                onClick={() => void confirmImport()}
                disabled={importing || preview.length === 0}
                className="rounded-md border border-brand bg-brand px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-50"
              >
                {importing ? 'Criando…' : 'Criar issues'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
