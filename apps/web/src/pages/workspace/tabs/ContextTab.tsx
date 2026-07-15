import { useCallback, useEffect, useState } from 'react';
import { api, Assertion } from '../../../lib/api';
import { OperationSteps, useOperation } from '../OperationSteps';

interface Props {
  projectId: string;
  syncNonce: number;
}

/**
 * Aba Contexto (SPEC-015, Fatia 10): o cofre do "o que não mexer" (ADR-013).
 * Lista as asserções de docs/CONTEXT.md, captura novas (write-back via bot) e
 * oferece a revalidação leve. A marca `a-revalidar` NUNCA é omitida.
 */
export function ContextTab({ projectId, syncNonce }: Props) {
  const [assertions, setAssertions] = useState<Assertion[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [operationId, setOperationId] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [statement, setStatement] = useState('');
  const [paths, setPaths] = useState('');
  const [body, setBody] = useState('');
  const [submitError, setSubmitError] = useState<string | null>(null);

  const reload = useCallback(() => {
    let active = true;
    setLoading(true);
    setError(null);
    api
      .assertions(projectId)
      .then((res) => active && setAssertions(res.assertions))
      .catch((err) => active && setError(String(err)))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [projectId]);

  useEffect(() => reload(), [reload, syncNonce]);

  const op = useOperation(operationId, () => {
    setOperationId(null);
    setFormOpen(false);
    setStatement('');
    setPaths('');
    setBody('');
    reload();
  });

  async function submit() {
    setSubmitError(null);
    const pathList = paths
      .split(/[,\n]/)
      .map((p) => p.trim())
      .filter(Boolean);
    try {
      const { operationId } = await api.captureAssertion(projectId, {
        statement: statement.trim(),
        paths: pathList,
        body: body.trim() || undefined,
      });
      setOperationId(operationId);
    } catch (err) {
      setSubmitError(String(err));
    }
  }

  async function revalidate(assertionId: string) {
    setSubmitError(null);
    try {
      const { operationId } = await api.revalidateAssertion(projectId, assertionId);
      setOperationId(operationId);
    } catch (err) {
      setSubmitError(String(err));
    }
  }

  if (loading) return <p className="p-6 text-sm text-text-muted">Carregando…</p>;
  if (error) return <p className="p-6 text-sm text-error">{error}</p>;

  const busy = op !== null && op.status === 'running';

  return (
    <div className="mx-auto max-w-3xl p-6">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold">Contexto — o que não mexer</h2>
          <p className="mt-1 text-xs text-text-muted">
            Asserções do dono, versionadas em <code>docs/CONTEXT.md</code>. Quando um
            path citado muda, a asserção vira <em>a revalidar</em> — nunca é apagada.
          </p>
        </div>
        {!formOpen && (
          <button
            onClick={() => setFormOpen(true)}
            className="rounded-md border border-border px-3 py-1.5 text-xs font-semibold hover:border-brand hover:text-brand"
          >
            Registrar asserção
          </button>
        )}
      </div>

      {op && (
        <div className="mb-4 rounded-md border border-border p-4">
          <OperationSteps op={op} />
        </div>
      )}
      {submitError && <p className="mb-4 text-sm text-error">{submitError}</p>}

      {formOpen && !busy && (
        <div className="mb-6 rounded-md border border-border p-4">
          <label className="block text-xs font-medium">
            O que não mexer (e por quê, em uma frase)
            <input
              value={statement}
              onChange={(e) => setStatement(e.target.value)}
              placeholder="Não refatorar o motor de folha v1 antes do corte com o contador"
              className="mt-1 w-full rounded-md border border-border bg-transparent px-3 py-2 text-sm"
            />
          </label>
          <label className="mt-3 block text-xs font-medium">
            Paths citados (vírgula ou linha)
            <input
              value={paths}
              onChange={(e) => setPaths(e.target.value)}
              placeholder="lib/folha/engine/, supabase/migrations/…"
              className="mt-1 w-full rounded-md border border-border bg-transparent px-3 py-2 text-sm"
            />
          </label>
          <label className="mt-3 block text-xs font-medium">
            Detalhe (opcional)
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={3}
              className="mt-1 w-full rounded-md border border-border bg-transparent px-3 py-2 text-sm"
            />
          </label>
          <div className="mt-3 flex gap-2">
            <button
              onClick={() => void submit()}
              disabled={!statement.trim() || !paths.trim()}
              className="rounded-md bg-brand px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
            >
              Salvar no repositório
            </button>
            <button
              onClick={() => setFormOpen(false)}
              className="rounded-md border border-border px-3 py-1.5 text-xs font-semibold"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}

      {assertions.length === 0 && !formOpen && (
        <div className="rounded-md border border-dashed border-border p-8 text-center text-sm text-text-muted">
          Nenhuma asserção registrada. O que só existe na sua cabeça — a gambiarra
          intencional, o módulo que parece morto e não é — morre com o contexto.
          Registre aqui e vira documentação versionada.
        </div>
      )}

      <ul className="space-y-3">
        {assertions.map((a) => (
          <li key={a.id} className="rounded-md border border-border p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="text-sm font-medium">{a.statement}</div>
              {/* A marca a-revalidar é OBRIGATÓRIA em toda exposição (SPEC-015) */}
              {a.status === 'a-revalidar' ? (
                <span
                  className="shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-semibold"
                  style={{
                    borderColor: 'var(--color-warning)',
                    color: 'var(--color-warning)',
                    backgroundColor:
                      'color-mix(in oklab, var(--color-warning) 8%, transparent)',
                  }}
                >
                  a revalidar
                </span>
              ) : (
                <span className="shrink-0 rounded-full border border-border px-2 py-0.5 text-[11px] text-text-muted">
                  vigente
                </span>
              )}
            </div>
            {a.body && <p className="mt-2 text-xs text-text-muted">{a.body}</p>}
            <div className="mt-2 text-[11px] text-text-muted">
              {a.paths.join(' · ')}
            </div>
            <div className="mt-1 flex items-center justify-between text-[11px] text-text-muted">
              <span>
                {a.author}
                {a.assertedAt ? ` · ${a.assertedAt}` : ''}
                {a.assertedSha ? ` · ${a.assertedSha}` : ''}
              </span>
              {a.status === 'a-revalidar' && !busy && (
                <button
                  onClick={() => void revalidate(a.id)}
                  className="rounded-md border border-border px-2 py-1 font-semibold hover:border-brand hover:text-brand"
                >
                  Ainda vale — confirmar
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
