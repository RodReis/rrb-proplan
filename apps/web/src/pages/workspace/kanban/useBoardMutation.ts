import { useCallback, useRef, useState } from 'react';
import { api, MutationInput } from '../../../lib/api';

const POLL_INTERVAL_MS = 800;
const POLL_TIMEOUT_MS = 30_000;

/**
 * Aplica uma mutação de board com UI otimista + polling do mutationId até
 * `applied` (SPEC-005). A borda pulsante para em `applied` — a projeção é
 * consequência e não é esperada aqui. Devolve o conjunto de números de card
 * "em voo" (para a borda pulsante) e a função de mutar.
 */
export function useBoardMutation(projectId: string, onSettled: () => void) {
  const [pending, setPending] = useState<Set<number>>(new Set());
  const timers = useRef<Set<ReturnType<typeof setTimeout>>>(new Set());

  const markPending = useCallback((n: number, on: boolean) => {
    setPending((prev) => {
      const next = new Set(prev);
      if (on) next.add(n);
      else next.delete(n);
      return next;
    });
  }, []);

  const pollUntilDone = useCallback(
    (mutationId: string): Promise<'applied' | 'failed'> =>
      new Promise((resolve) => {
        const start = Date.now();
        const tick = async () => {
          try {
            const s = await api.mutationStatus(projectId, mutationId);
            if (s.status === 'applied') return resolve('applied');
            if (s.status === 'failed') return resolve('failed');
          } catch {
            // erro transitório de polling — tenta de novo até o timeout
          }
          if (Date.now() - start > POLL_TIMEOUT_MS) return resolve('failed');
          const t = setTimeout(tick, POLL_INTERVAL_MS);
          timers.current.add(t);
        };
        void tick();
      }),
    [projectId],
  );

  /**
   * @param cardNumber número do card para a borda pulsante (null em create,
   *   que ainda não tem número).
   */
  const mutate = useCallback(
    async (input: MutationInput, cardNumber: number | null): Promise<boolean> => {
      if (cardNumber !== null) markPending(cardNumber, true);
      try {
        const { mutationId } = await api.mutateBoard(projectId, input);
        const result = await pollUntilDone(mutationId);
        return result === 'applied';
      } catch {
        return false;
      } finally {
        if (cardNumber !== null) markPending(cardNumber, false);
        onSettled();
      }
    },
    [projectId, markPending, pollUntilDone, onSettled],
  );

  return { pending, mutate };
}
