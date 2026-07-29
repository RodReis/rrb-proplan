import { useCallback, useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { getDashboard, getPendingCount } from '../../lib/api';

export interface DashboardNav {
  /**
   * O tenant tem algum cliente?
   *
   * `false` **esconde o item de menu** (§2.12, decisão do PI) — que é diferente
   * de mostrá-lo vazio: uma tela de retomada sem nada a retomar não é
   * informação, é ruído no menu.
   *
   * Começa `false` e só liga quando o servidor confirma: mostrar o item e
   * escondê-lo meio segundo depois pisca na cara de quem já ia clicar.
   */
  hasClients: boolean;
  /**
   * O contador de *Esperando você*, ou `null` quando não se sabe.
   *
   * `null` **não vira zero**. Zero é a afirmação *"nada espera por você"*, e é a
   * mais cara de errar nesta tela: a pessoa deixa de olhar. Sem número é
   * honesto; zero falso não é.
   */
  pendingCount: number | null;
}

/**
 * O que o menu global precisa saber sobre o dashboard (SPEC-035 §2.10, §2.12).
 *
 * ## Quando atualiza, e por que não em intervalo
 *
 * **Ao navegar entre telas e ao voltar o foco da aba** — decisão 4 do PI. Não há
 * polling, e o §5 cobra a ausência de `setInterval` por nome.
 *
 * O motivo não é economia de request: um contador em intervalo fixo mudaria
 * sozinho enquanto a pessoa olha para ele, sem que nada que ela fez tenha
 * causado a mudança. Os dois momentos escolhidos são justamente aqueles em que
 * ela **espera** que a tela esteja fresca — chegou agora, ou voltou agora.
 *
 * ## Duas chamadas, e a segunda só quando a primeira justifica
 *
 * `hasClients` sai do `GET /dashboard`, que é a resposta que já sabe disso; o
 * contador tem rota própria porque é chamado a cada navegação e não deve
 * arrastar o dashboard inteiro junto (§6). Sem cliente nenhum, o contador **não
 * é buscado** — não haveria item de menu para exibi-lo.
 */
export function useDashboardNav(enabled: boolean): DashboardNav {
  const [hasClients, setHasClients] = useState(false);
  const [pendingCount, setPendingCount] = useState<number | null>(null);
  const { pathname } = useLocation();

  const refresh = useCallback(async () => {
    if (!enabled) return;
    try {
      const view = await getDashboard();
      setHasClients(view.hasAnyClient);
      if (!view.hasAnyClient) {
        setPendingCount(null);
        return;
      }
      const { count } = await getPendingCount();
      setPendingCount(count);
    } catch {
      // Falha some com o badge; **nunca vira zero**. E não esconde o item já
      // exibido: uma falha de rede não é evidência de que os clientes sumiram.
      setPendingCount(null);
    }
  }, [enabled]);

  useEffect(() => {
    void refresh();
  }, [refresh, pathname]);

  // `visibilitychange` e não `focus`: clicar de volta numa janela que nunca
  // ficou oculta não é "voltar" — e dispararia request a cada alt-tab curto, que
  // é o polling que a decisão evitou, com outro nome.
  useEffect(() => {
    if (!enabled) return;
    const aoVoltar = () => {
      if (document.visibilityState === 'visible') void refresh();
    };
    document.addEventListener('visibilitychange', aoVoltar);
    return () => document.removeEventListener('visibilitychange', aoVoltar);
  }, [enabled, refresh]);

  return { hasClients, pendingCount };
}
