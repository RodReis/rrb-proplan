import { useCallback, useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { getActiveTenant, getDashboard, getPendingCount } from '../../lib/api';

/**
 * O último `hasAnyClient` confirmado pelo servidor, por tenant.
 *
 * ## Por que memória de módulo, e não estado do componente
 *
 * O `GlobalNav` é **remontado a cada navegação** — cada tela traz o seu. Com o
 * estado nascendo em `false` toda vez, o item Dashboard sumia e voltava num
 * intervalo medido em **26 ms** no dogfooding: rápido demais para ler, lento o
 * bastante para o olho pegar. A tremida que o PI reportou em 2026-07-31.
 *
 * O fato "este tenant tem clientes" **não muda entre duas telas**. Quem esquecia
 * era a montagem, não o servidor — então a resposta viaja entre montagens, e a
 * primeira render já sabe o que a anterior tinha confirmado.
 *
 * Chaveado por tenant porque a resposta é dele: trocar de workspace não pode
 * herdar o "tem clientes" do anterior. `undefined` é *"nunca perguntei"*, que é
 * diferente de `false` — e é essa distinção que evita mostrar o item para quem
 * ainda não sabemos se tem cliente.
 */
const clientesPorTenant = new Map<string, boolean>();

/**
 * O último contador confirmado, por tenant — mesma razão do mapa acima.
 *
 * Sem ele o badge desaparecia e voltava a cada navegação, e um número que
 * pisca é pior que um número que demora: sugere que algo mudou quando nada
 * mudou. Continua sendo **substituído** pela resposta nova assim que ela chega;
 * o que se evita é o intervalo em branco no meio.
 */
const contadorPorTenant = new Map<string, number>();

/**
 * Esquece o que foi confirmado. **Existe para os testes**, que compartilham o
 * módulo entre casos e veriam a memória de um vazar no seguinte.
 *
 * Não é usada pelo app: em produção a memória dura o que dura a aba, e a
 * resposta nova sempre a substitui.
 */
export function resetDashboardNavCache(): void {
  clientesPorTenant.clear();
  contadorPorTenant.clear();
}

export interface DashboardNav {
  /**
   * O tenant tem algum cliente?
   *
   * `false` **esconde o item de menu** (§2.12, decisão do PI) — que é diferente
   * de mostrá-lo vazio: uma tela de retomada sem nada a retomar não é
   * informação, é ruído no menu.
   *
   * Na **primeira** visita começa `false` e só liga quando o servidor confirma:
   * mostrar o item e escondê-lo meio segundo depois pisca na cara de quem já ia
   * clicar. Nas seguintes parte da última resposta conhecida do tenant, para o
   * item não piscar a cada navegação.
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
  // Parte do que o servidor já confirmou para este tenant (ver
  // `clientesPorTenant` acima): sem isso o item pisca a cada navegação, porque
  // o `GlobalNav` é remontado e o estado voltaria para `false`.
  const [hasClients, setHasClients] = useState(
    () => clientesPorTenant.get(getActiveTenant() ?? '') ?? false,
  );
  const [pendingCount, setPendingCount] = useState<number | null>(
    () => contadorPorTenant.get(getActiveTenant() ?? '') ?? null,
  );
  const { pathname } = useLocation();

  /**
   * Busca uma vez; **sem tenant ativo, espera o próximo quadro e tenta de novo**
   * — é o que fecha o FIX #230.
   *
   * ## A corrida, medida no navegador
   *
   * Numa navegação entre telas (Licenças → Catálogo), a ordem real é:
   *
   * 1. a URL muda e o `GlobalNav` **ainda montado** reage ao novo `pathname`;
   * 2. ele dispara `getDashboard()` com `activeTenant` já nulo (o cleanup da
   *    rota que sai correu antes) → sai `/dashboard` cru, a API devolve **404**;
   * 3. só então o shell de destino monta e fixa o tenant.
   *
   * O `catch` preserva o estado anterior, mas o componente é desmontado logo
   * depois: o `GlobalNav` novo nasce com `hasClients` em `false` e **nunca
   * repete a chamada**, porque para ele o `pathname` já é o de destino e nada
   * mais muda. Daí o sintoma: com F5 o item aparece, navegando não.
   *
   * Observar `getActiveTenant()` na render não resolve — o `GlobalNav` não
   * re-renderiza quando um valor de módulo muda. Reagendar é o que funciona,
   * porque o passo 3 acontece no mesmo tick: um `requestAnimationFrame` depois,
   * o tenant já está lá.
   */
  const refresh = useCallback(async () => {
    if (!enabled) return;

    const tenant = getActiveTenant();
    if (!tenant) {
      // Sem tenant a chamada sairia sem `/t/:tenant` e morreria em 404. Esperar
      // o próximo quadro custa um frame e evita a requisição inútil.
      return 'sem-tenant' as const;
    }

    try {
      const view = await getDashboard();
      setHasClients(view.hasAnyClient);
      // Guarda para a próxima montagem do menu: é isto que impede o item de
      // piscar a cada navegação (ver `clientesPorTenant`).
      clientesPorTenant.set(tenant, view.hasAnyClient);
      if (!view.hasAnyClient) {
        setPendingCount(null);
        return;
      }
      const { count } = await getPendingCount();
      setPendingCount(count);
      contadorPorTenant.set(tenant, count);
    } catch {
      // Falha some com o badge; **nunca vira zero**. E não esconde o item já
      // exibido: uma falha de rede não é evidência de que os clientes sumiram.
      setPendingCount(null);
    }
  }, [enabled]);

  useEffect(() => {
    let vivo = true;
    let quadro = 0;

    const tentar = () => {
      void refresh().then((r) => {
        // Uma tentativa a mais, no quadro seguinte: o shell de destino fixa o
        // tenant durante a própria render, então ele já estará lá. Não é laço —
        // se ainda faltar, é porque a tela não tem tenant mesmo (sessão sem
        // membership), e o item não deve aparecer.
        if (r === 'sem-tenant' && vivo && quadro === 0) {
          quadro = requestAnimationFrame(() => {
            quadro = 0;
            void refresh();
          });
        }
      });
    };

    tentar();
    return () => {
      vivo = false;
      if (quadro) cancelAnimationFrame(quadro);
    };
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
