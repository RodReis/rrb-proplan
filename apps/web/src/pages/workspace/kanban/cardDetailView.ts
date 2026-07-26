/**
 * Lógica da gaveta de detalhe (SPEC-030) fora do React.
 *
 * O que mora aqui é o que erra em silêncio: a frase do evento na trilha e o
 * corte dos 10 mais recentes. Um teste de markup provaria que "algo apareceu";
 * estes provam **o que** apareceu — e ordem/rótulo errados na trilha são o tipo
 * de defeito que passa numa revisão visual.
 */
import type { CardEvent, CardEventType } from '../../../lib/api';

/** Quantos eventos a trilha mostra antes do "ver todos" (decisão do PI). */
export const TIMELINE_PREVIEW = 10;

/**
 * A trilha é exibida **do mais recente para o mais antigo** — ao abrir um card,
 * o que interessa é o que acabou de acontecer. A API entrega cronológico
 * crescente (contrato), então aqui inverte.
 *
 * Não muta o array recebido: `reverse()` in-place viraria bug quando o mesmo
 * payload for lido duas vezes (ex.: re-render antes do refetch).
 */
export function timelineNewestFirst(events: CardEvent[]): CardEvent[] {
  return [...events].reverse();
}

/**
 * Os `TIMELINE_PREVIEW` primeiros + quantos sobraram. `hiddenCount === 0` ⇒ a UI
 * não mostra "ver todos", porque não há o que ver.
 *
 * Sem paginação contra o GitHub: a timeline inteira já veio na leitura, expandir
 * é só deixar de cortar.
 */
export function splitTimeline(
  events: CardEvent[],
  expanded: boolean,
): { visible: CardEvent[]; hiddenCount: number } {
  const ordered = timelineNewestFirst(events);
  if (expanded || ordered.length <= TIMELINE_PREVIEW) {
    return { visible: ordered, hiddenCount: 0 };
  }
  return {
    visible: ordered.slice(0, TIMELINE_PREVIEW),
    hiddenCount: ordered.length - TIMELINE_PREVIEW,
  };
}

/**
 * A frase do evento, em pt-BR. Mostra o fato **como o GitHub o registra** — a
 * SPEC-030 é explícita em não sintetizar "moveu de X para Y" a partir das labels
 * `proplan:*`, mesmo sendo elas o histórico de coluna.
 *
 * Ator ausente (ação do sistema, conta removida) vira "alguém": a trilha não
 * pode ficar muda nem inventar nome.
 */
export function describeEvent(event: CardEvent): string {
  const quem = event.actor?.login ?? 'alguém';

  switch (event.type) {
    case 'opened':
      return `${quem} abriu`;
    case 'closed':
      return `${quem} fechou`;
    case 'reopened':
      return `${quem} reabriu`;
    case 'assigned':
      return event.assignee
        ? `${quem} atribuiu a ${event.assignee.login}`
        : `${quem} atribuiu`;
    case 'unassigned':
      return event.assignee
        ? `${quem} removeu a atribuição de ${event.assignee.login}`
        : `${quem} removeu a atribuição`;
    case 'labeled':
      return `${quem} adicionou`;
    case 'unlabeled':
      return `${quem} removeu`;
    case 'renamed':
      return `${quem} renomeou`;
  }
}

/** Rótulo de estado da issue, do jeito que o board já fala. */
export function stateLabel(state: 'open' | 'closed'): string {
  return state === 'open' ? 'aberta' : 'fechada';
}

/**
 * Cor de texto legível sobre o fundo da label. O GitHub devolve só a cor de
 * fundo (`color`, hex sem `#`) — quem decide preto ou branco é o consumidor.
 *
 * Luminância percebida (recomendação do W3C para contraste); acima de 0.6 usa
 * texto escuro. Sem isto, `fbca04` (amarelo das labels de prioridade) sai com
 * texto branco e fica ilegível.
 *
 * ponytail: aproximação sRGB sem correção de gama — troca por WCAG relative
 * luminance se alguma label ficar no limite e reclamarem.
 */
export function labelTextColor(hex: string): '#000' | '#fff' {
  const clean = hex.replace('#', '');
  if (clean.length !== 6) return '#000'; // hex inesperado → escuro, o mais seguro
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  if ([r, g, b].some(Number.isNaN)) return '#000';
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.6 ? '#000' : '#fff';
}

/** Só os tipos que o contrato mapeia — usado no teste de exaustividade. */
export const EVENT_TYPES: CardEventType[] = [
  'opened',
  'assigned',
  'unassigned',
  'labeled',
  'unlabeled',
  'closed',
  'reopened',
  'renamed',
];
