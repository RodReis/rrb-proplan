import { useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence, MotionConfig, motion } from 'framer-motion';
import { api, Assertion } from '../../../lib/api';
import { OperationSteps, useOperation } from '../OperationSteps';

interface Props {
  projectId: string;
  syncNonce: number;
}

const EASE_OUT_EXPO: [number, number, number, number] = [0.16, 1, 0.3, 1];

/**
 * Aba Contexto (SPEC-015, Fatia 10): o cofre do "o que não mexer" (ADR-013).
 * Lista as asserções de docs/CONTEXT.md, captura novas (write-back via bot) e
 * oferece a revalidação leve. A marca `a-revalidar` NUNCA é omitida — e, como o
 * Feito no Kanban, é fila de ação do dono: destaque âmbar (DESIGN.md).
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
  // Stagger só na primeira montagem (DESIGN.md) — refetch não re-anima.
  const animatedOnce = useRef(false);

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

  const busy = op !== null && op.status === 'running';
  const staleCount = assertions.filter((a) => a.status === 'a-revalidar').length;
  const currentCount = assertions.length - staleCount;
  if (!loading && !animatedOnce.current) animatedOnce.current = true;

  return (
    <MotionConfig reducedMotion="user">
      <div className="mx-auto max-w-3xl px-8 py-6">
        {/* Header: título + contadores à esquerda, CTA primário carbono à direita */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-base font-semibold text-text">
              Contexto — o que não mexer
            </h2>
            <p className="mt-1 max-w-[58ch] text-xs leading-relaxed text-text-muted">
              Asserções do dono, versionadas em{' '}
              <code className="rounded bg-surface-hover px-1 py-0.5 font-mono text-[11px]">
                docs/CONTEXT.md
              </code>
              . Quando um path citado muda, a asserção vira <em>a revalidar</em> —
              nunca é apagada.
            </p>
          </div>
          {!formOpen && !busy && (
            <button
              onClick={() => setFormOpen(true)}
              className="shrink-0 rounded-md bg-brand px-3.5 py-2 text-xs font-semibold text-white transition-all duration-150 hover:bg-brand/90 hover:shadow-sm active:scale-[0.97]"
            >
              Registrar asserção
            </button>
          )}
        </div>

        {/* Contadores — a-revalidar é fila de ação do dono (âmbar, como Feito no Kanban) */}
        {!loading && assertions.length > 0 && (
          <div className="mt-4 flex items-center gap-2 text-[11px]">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface px-2.5 py-1 text-text-muted">
              <span className="size-1.5 rounded-full bg-success" aria-hidden />
              {currentCount} vigente{currentCount === 1 ? '' : 's'}
            </span>
            {staleCount > 0 && (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-warning/40 bg-warning/10 px-2.5 py-1 font-semibold text-warning-strong">
                <span className="size-1.5 rounded-full bg-warning" aria-hidden />
                {staleCount} a revalidar
              </span>
            )}
          </div>
        )}

        {/* Operação em curso: passos nomeados (SPEC-010) */}
        <AnimatePresence>
          {op && (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2, ease: EASE_OUT_EXPO }}
              className="mt-5 rounded-lg border border-border bg-surface p-4"
            >
              <OperationSteps op={op} />
            </motion.div>
          )}
        </AnimatePresence>

        {submitError && (
          <div className="mt-5 rounded-md border border-error/30 bg-error/5 px-4 py-3 text-sm text-error">
            {submitError}
          </div>
        )}

        {/* Formulário de captura */}
        <AnimatePresence initial={false}>
          {formOpen && !busy && (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 4 }}
              transition={{ duration: 0.2, ease: EASE_OUT_EXPO }}
              className="mt-5 rounded-lg border border-border bg-surface p-5"
            >
              <h3 className="text-sm font-semibold text-text">Nova asserção</h3>
              <p className="mt-0.5 text-[11px] text-text-muted">
                Autor, data e SHA do repositório são preenchidos automaticamente.
              </p>

              <label className="mt-4 block">
                <span className="text-xs font-medium text-text">
                  O que não mexer (uma frase)
                </span>
                <input
                  value={statement}
                  onChange={(e) => setStatement(e.target.value)}
                  placeholder="Não refatorar o motor de folha v1 antes do corte com o contador"
                  className="mt-1.5 w-full rounded-md border border-border bg-bg px-3 py-2 text-sm text-text outline-none transition-all duration-150 placeholder:text-text-muted/80 focus:border-brand focus:ring-4 focus:ring-brand/25"
                />
              </label>

              <label className="mt-3.5 block">
                <span className="text-xs font-medium text-text">Paths citados</span>
                <input
                  value={paths}
                  onChange={(e) => setPaths(e.target.value)}
                  placeholder="lib/folha/engine/, supabase/migrations/…"
                  className="mt-1.5 w-full rounded-md border border-border bg-bg px-3 py-2 font-mono text-[13px] text-text outline-none transition-all duration-150 placeholder:font-sans placeholder:text-sm placeholder:text-text-muted/80 focus:border-brand focus:ring-4 focus:ring-brand/25"
                />
                <span className="mt-1 block text-[11px] text-text-muted">
                  Separe por vírgula ou quebra de linha. São eles que datam a validade.
                </span>
              </label>

              <label className="mt-3.5 block">
                <span className="text-xs font-medium text-text">
                  Detalhe <span className="font-normal text-text-muted">(opcional)</span>
                </span>
                <textarea
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  rows={3}
                  placeholder="Por quê? O que acontece se mexerem?"
                  className="mt-1.5 w-full resize-y rounded-md border border-border bg-bg px-3 py-2 text-sm leading-relaxed text-text outline-none transition-all duration-150 placeholder:text-text-muted/80 focus:border-brand focus:ring-4 focus:ring-brand/25"
                />
              </label>

              <div className="mt-4 flex items-center gap-2 border-t border-border pt-4">
                <button
                  onClick={() => void submit()}
                  disabled={!statement.trim() || !paths.trim()}
                  className="rounded-md bg-brand px-3.5 py-2 text-xs font-semibold text-white transition-all duration-150 hover:bg-brand/90 hover:shadow-sm active:scale-[0.97] disabled:pointer-events-none disabled:opacity-40"
                >
                  Salvar no repositório
                </button>
                <button
                  onClick={() => setFormOpen(false)}
                  className="rounded-md px-3.5 py-2 text-xs font-semibold text-text-muted transition-colors duration-150 hover:bg-surface-hover hover:text-text"
                >
                  Cancelar
                </button>
                <span className="ml-auto text-[11px] text-text-muted">
                  Vira commit do <span className="font-mono">proplan[bot]</span>
                </span>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Carga: skeleton, nunca spinner (DESIGN.md) */}
        {loading && (
          <div className="mt-5 space-y-3" aria-hidden>
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-24 animate-pulse rounded-lg bg-border/50" />
            ))}
          </div>
        )}

        {error && (
          <div className="mt-5 rounded-md border border-error/30 bg-error/5 px-4 py-3 text-sm text-error">
            {error}
          </div>
        )}

        {/* Empty state que ensina (DESIGN.md: ilustração + CTA, fade + slide-up) */}
        {!loading && !error && assertions.length === 0 && !formOpen && (
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.25, ease: EASE_OUT_EXPO }}
            className="mt-6 overflow-hidden rounded-lg border border-border bg-surface"
          >
            <div className="grid md:grid-cols-[1fr_auto]">
              {/* Coluna do convite */}
              <div className="flex flex-col justify-center p-7">
                <div className="flex size-11 items-center justify-center rounded-md border border-border bg-bg text-text">
                  <svg
                    width="20"
                    height="20"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden
                  >
                    <path d="M12 3l7 3v5c0 4.5-3 8.5-7 10-4-1.5-7-5.5-7-10V6l7-3z" />
                    <path d="M12 8v4" />
                    <circle cx="12" cy="15" r="0.5" fill="currentColor" />
                  </svg>
                </div>
                <h3 className="mt-4 text-[15px] font-semibold text-text">
                  O que um agente não pode descobrir sozinho
                </h3>
                <p className="mt-2 max-w-[46ch] text-sm leading-relaxed text-text-muted">
                  A gambiarra intencional. O módulo que parece morto e não é. O drop
                  que não pode rodar antes do corte. Isso só existe na sua cabeça —
                  registre e vira documentação versionada no repositório.
                </p>
                <div className="mt-5 flex items-center gap-3">
                  <button
                    onClick={() => setFormOpen(true)}
                    className="whitespace-nowrap rounded-md bg-brand px-4 py-2 text-xs font-semibold text-white transition-all duration-150 hover:bg-brand/90 hover:shadow-sm active:scale-[0.97]"
                  >
                    Registrar a primeira
                  </button>
                  <span className="text-[11px] text-text-muted">
                    Vira commit em{' '}
                    <span className="font-mono">docs/CONTEXT.md</span>
                  </span>
                </div>
              </div>

              {/* Card-exemplo fantasma: ensina a anatomia de uma asserção */}
              <div
                aria-hidden
                className="relative hidden select-none items-center border-t border-border bg-bg p-7 md:flex md:w-[340px] md:border-l md:border-t-0"
              >
                <div className="pointer-events-none w-full">
                  <div className="rounded-lg border border-border bg-surface p-4 shadow-sm">
                    <div className="flex items-start justify-between gap-3">
                      <p className="text-[13px] font-semibold leading-snug text-text">
                        Não refatorar o motor de folha v1 antes do corte
                      </p>
                      <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-border px-2 py-0.5 text-[10px] text-text-muted">
                        <span className="size-1.5 rounded-full bg-success/70" />
                        vigente
                      </span>
                    </div>
                    <p className="mt-1.5 text-xs leading-relaxed text-text-muted">
                      O drop é irreversível e depende de validação fiscal.
                    </p>
                    <div className="mt-2.5 flex flex-wrap gap-1.5">
                      <code className="rounded border border-border bg-bg px-1.5 py-0.5 font-mono text-[10px] text-text-muted">
                        lib/folha/engine/
                      </code>
                    </div>
                    <div className="mt-2.5 border-t border-border/70 pt-2 text-[10px] text-text-muted">
                      você · hoje · <span className="font-mono">a1b2c3d</span>
                    </div>
                  </div>
                  {/* Segundo card, cortado — sugere a lista que cresce */}
                  <div className="mt-3 rounded-lg border border-warning/40 bg-warning/[0.06] p-4 opacity-80">
                    <div className="flex items-start justify-between gap-3">
                      <p className="text-[13px] font-semibold leading-snug text-text">
                        O módulo de portaria parece morto — não é
                      </p>
                      <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-warning/40 bg-warning/10 px-2 py-0.5 text-[10px] font-semibold text-warning-strong">
                        <span className="size-1.5 rounded-full bg-warning" />
                        a revalidar
                      </span>
                    </div>
                    <div className="mt-2.5 flex justify-end">
                      <span className="rounded-md border border-warning/50 px-2 py-0.5 text-[10px] font-semibold text-warning-strong">
                        Ainda vale — confirmar
                      </span>
                    </div>
                  </div>
                  <p className="mt-3 text-center text-[10px] uppercase tracking-wide text-text-muted/70">
                    exemplo
                  </p>
                </div>
              </div>
            </div>
          </motion.div>
        )}

        {/* Lista de asserções */}
        {!loading && assertions.length > 0 && (
          <ul className="mt-5 space-y-3">
            {assertions.map((a, i) => {
              const stale = a.status === 'a-revalidar';
              return (
                <motion.li
                  key={a.id}
                  initial={
                    animatedOnce.current ? false : { opacity: 0, y: 12 }
                  }
                  animate={{ opacity: 1, y: 0 }}
                  transition={{
                    duration: 0.2,
                    delay: Math.min(i * 0.04, 0.4),
                    ease: EASE_OUT_EXPO,
                  }}
                  className={
                    'group rounded-lg border bg-surface p-4 transition-all duration-150 hover:-translate-y-0.5 hover:shadow-sm ' +
                    (stale
                      ? 'border-warning/40 bg-warning/[0.04] hover:border-warning/60'
                      : 'border-border hover:border-brand/30')
                  }
                >
                  <div className="flex items-start justify-between gap-3">
                    <p className="text-sm font-semibold leading-snug text-text">
                      {a.statement}
                    </p>
                    {/* A marca a-revalidar é OBRIGATÓRIA em toda exposição (SPEC-015) */}
                    {stale ? (
                      <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-warning/40 bg-warning/10 px-2 py-0.5 text-[11px] font-semibold text-warning-strong">
                        <span className="size-1.5 rounded-full bg-warning" aria-hidden />
                        a revalidar
                      </span>
                    ) : (
                      <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-border px-2 py-0.5 text-[11px] text-text-muted">
                        <span className="size-1.5 rounded-full bg-success/70" aria-hidden />
                        vigente
                      </span>
                    )}
                  </div>

                  {a.body && (
                    <p className="mt-1.5 max-w-[68ch] text-[13px] leading-relaxed text-text-muted">
                      {a.body}
                    </p>
                  )}

                  {a.paths.length > 0 && (
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {a.paths.map((p) => (
                        <code
                          key={p}
                          className="rounded border border-border bg-bg px-1.5 py-0.5 font-mono text-[11px] text-text-muted"
                        >
                          {p}
                        </code>
                      ))}
                    </div>
                  )}

                  <div className="mt-3 flex items-center justify-between border-t border-border/70 pt-2.5">
                    <span className="text-[11px] text-text-muted">
                      {a.author}
                      {a.assertedAt && (
                        <>
                          {' · '}
                          <time dateTime={a.assertedAt}>{a.assertedAt}</time>
                        </>
                      )}
                      {a.assertedSha && (
                        <>
                          {' · '}
                          <span className="font-mono">{a.assertedSha}</span>
                        </>
                      )}
                    </span>
                    {stale && !busy && (
                      <button
                        onClick={() => void revalidate(a.id)}
                        className="rounded-md border border-warning/50 px-2.5 py-1 text-[11px] font-semibold text-warning-strong transition-all duration-150 hover:bg-warning/10 active:scale-[0.97]"
                      >
                        Ainda vale — confirmar
                      </button>
                    )}
                  </div>
                </motion.li>
              );
            })}
          </ul>
        )}
      </div>
    </MotionConfig>
  );
}
