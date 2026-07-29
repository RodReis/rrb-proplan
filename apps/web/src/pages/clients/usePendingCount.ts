import { useCallback, useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { getPendingCount } from '../../lib/api';

/**
 * O contador de *Esperando você* no menu (SPEC-035 §2.10).
 *
 * ## Quando atualiza, e por que não em intervalo
 *
 * **Ao navegar entre telas e ao voltar o foco da aba** — a decisão 4 do PI. Não
 * há polling, e o §5 cobra isso *por ausência de `setInterval`*.
 *
 * O motivo não é economia de request: um contador em intervalo fixo mudaria
 * sozinho enquanto a pessoa olha para ele, sem que nada que ela fez tenha
 * causado a mudança. Os dois momentos escolhidos são justamente aqueles em que
 * ela **espera** que a tela esteja fresca — chegou agora, ou voltou agora.
 *
 * ## Falha vira `null`, não zero
 *
 * Request que falha devolve `null`, e o menu **não mostra badge nenhum**. Zero
 * seria uma afirmação — *"nada espera por você"* — e é a mais cara de errar
 * nesta tela: a pessoa deixa de olhar. Sem número é honesto; zero falso não é.
 */
export function usePendingCount(enabled: boolean): number | null {
  const [count, setCount] = useState<number | null>(null);
  const { pathname } = useLocation();

  const refresh = useCallback(async () => {
    if (!enabled) return;
    try {
      const { count: n } = await getPendingCount();
      setCount(n);
    } catch {
      // Ver o cabeçalho: falha some com o badge, nunca vira zero.
      setCount(null);
    }
  }, [enabled]);

  // Ao navegar: `pathname` na dependência é o gatilho.
  useEffect(() => {
    void refresh();
  }, [refresh, pathname]);

  // Ao voltar o foco da aba. `visibilitychange` e não `focus`: clicar de volta
  // numa janela que nunca ficou oculta não é "voltar" — e dispararia request a
  // cada alt-tab curto, que é o polling que a decisão evitou, com outro nome.
  useEffect(() => {
    if (!enabled) return;
    const aoVoltar = () => {
      if (document.visibilityState === 'visible') void refresh();
    };
    document.addEventListener('visibilitychange', aoVoltar);
    return () => document.removeEventListener('visibilitychange', aoVoltar);
  }, [enabled, refresh]);

  return count;
}
