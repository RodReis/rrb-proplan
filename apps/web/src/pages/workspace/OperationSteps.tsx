import { useEffect, useRef, useState } from 'react';
import { api, OperationView } from '../../lib/api';

const POLL_MS = 1000;
const TIMEOUT_MS = 90_000;

/**
 * Polling de uma operação assíncrona (SPEC-010). Estado mora no servidor — este
 * hook só lê. Para quando a operação termina (done|failed) ou estoura o teto.
 * onDone dispara uma vez, quando status vira `done` (o consumidor recarrega a aba).
 */
export function useOperation(
  operationId: string | null,
  onDone?: () => void,
): OperationView | null {
  const [op, setOp] = useState<OperationView | null>(null);
  const doneFired = useRef(false);

  useEffect(() => {
    if (!operationId) return;
    doneFired.current = false;
    let active = true;
    const start = Date.now();

    async function tick() {
      if (!active) return;
      try {
        const view = await api.operation(operationId!);
        if (!active) return;
        setOp(view);
        if (view.status === 'done' && !doneFired.current) {
          doneFired.current = true;
          onDone?.();
          return;
        }
        if (view.status === 'failed') return;
      } catch {
        // erro transitório de polling — tenta de novo até o teto
      }
      if (Date.now() - start < TIMEOUT_MS) {
        setTimeout(() => void tick(), POLL_MS);
      }
    }
    void tick();
    return () => {
      active = false;
    };
    // onDone é estável o suficiente (definido no pai); reexecutar só no id
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [operationId]);

  return op;
}

const DOT: Record<string, string> = {
  pending: 'border-border',
  running: 'border-brand border-t-transparent animate-spin',
  done: 'border-brand bg-brand',
  failed: 'border-error bg-error',
};

/**
 * Lista de passos nomeados de uma operação de escrita. Mostra o que o ProPlan
 * está fazendo no repositório do usuário — nunca a tela fica igual e muda.
 */
export function OperationSteps({ op }: { op: OperationView }) {
  return (
    <div className="rounded-md border border-border bg-bg p-3 text-xs">
      <ul className="space-y-2">
        {op.steps.map((s) => (
          <li key={s.key} className="flex items-center gap-2.5">
            <span
              className={`h-3.5 w-3.5 shrink-0 rounded-full border-2 ${DOT[s.status]}`}
              aria-hidden
            />
            <span
              className={
                s.status === 'failed'
                  ? 'text-error'
                  : s.status === 'pending'
                    ? 'text-text-muted'
                    : 'text-text'
              }
            >
              {s.label}
            </span>
          </li>
        ))}
      </ul>
      {op.status === 'failed' && op.error && (
        <p className="mt-2 border-t border-border pt-2 text-error">{op.error}</p>
      )}
    </div>
  );
}
