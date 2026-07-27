import type { FunnelCard, FunnelBoardColumn, ClientProjectState, FunnelColumn } from '../../lib/api';

/**
 * Lógica pura do Kanban de clientes (SPEC-029). Separada do componente porque é
 * o que precisa de teste: mover um card otimisticamente e **desfazer** quando o
 * servidor recusa é o critério de aceite mais fácil de regredir, e um teste de
 * markup não o provaria.
 */

/** Rótulos das 4 colunas — a ordem vem do servidor, não daqui. */
export const COLUMN_LABELS: Record<FunnelColumn, string> = {
  novo: 'Novo / Link enviado',
  briefing: 'Briefing',
  prompt_contrato: 'Prompt e contrato',
  producao_entrega: 'Produção e entrega',
};

/**
 * Rótulo legível de cada estado interno — o card mostra o estado, não a coluna.
 *
 * **Quem lê estes rótulos é o prestador**, e por isso `BRIEFING_SUBMITTED` diz
 * *respondido*, não *enviado*: ao lado de `LINK_SENT` ("Link enviado"), a
 * palavra "enviado" apareceria duas vezes com sujeitos opostos — nós mandamos o
 * link, o cliente mandou as respostas. Do lado de quem responde o verbo é
 * enviar; deste lado é responder. Trocado no dogfooding de 2026-07-27.
 */
export const STATE_LABELS: Record<ClientProjectState, string> = {
  DRAFT: 'Rascunho',
  LINK_SENT: 'Link enviado',
  BRIEFING_STARTED: 'Briefing iniciado',
  BRIEFING_SUBMITTED: 'Briefing respondido',
  ARTIFACTS_READY: 'Artefatos prontos',
  CONTRACT_PENDING: 'Contrato pendente',
  CONTRACT_APPROVED: 'Contrato aprovado',
  IN_PRODUCTION: 'Em produção',
  DELIVERED: 'Entregue',
  ARCHIVED: 'Arquivado',
};

/** Token de cor por coluna (DESIGN.md §4) — semântico, não decorativo. */
export const COLUMN_TINT: Record<FunnelColumn, string> = {
  novo: 'var(--slate)',
  briefing: 'var(--info)',
  prompt_contrato: 'var(--warning)',
  producao_entrega: 'var(--success)',
};

/**
 * Move um card entre colunas, devolvendo um board NOVO (imutável).
 *
 * Devolve o board original **sem clonar** quando o card não existe ou já está
 * na coluna alvo: assim o caller distingue "nada mudou" por identidade
 * (`next === board`) e não dispara request nem re-render à toa.
 */
export function moveCard(
  board: FunnelBoardColumn[],
  cardId: string,
  target: FunnelColumn,
): FunnelBoardColumn[] {
  const from = board.find((c) => c.cards.some((card) => card.id === cardId));
  if (!from || from.column === target) return board;

  const card = from.cards.find((c) => c.id === cardId)!;
  return board.map((col) => {
    if (col.column === from.column) {
      return { ...col, cards: col.cards.filter((c) => c.id !== cardId) };
    }
    if (col.column === target) {
      return { ...col, cards: [card, ...col.cards] };
    }
    return col;
  });
}

/** Coluna atual de um card — o caller guarda para poder desfazer. */
export function columnOf(
  board: FunnelBoardColumn[],
  cardId: string,
): FunnelColumn | null {
  return board.find((c) => c.cards.some((card) => card.id === cardId))?.column ?? null;
}

/**
 * Aplica o estado que o servidor confirmou.
 *
 * A UI move por COLUNA, mas o servidor responde com o ESTADO interno (a coluna
 * pode ter vários). Sem isto o card ficaria mostrando o estado antigo até o
 * próximo refetch — visualmente na coluna certa, com o rótulo errado.
 */
export function applyConfirmedState(
  board: FunnelBoardColumn[],
  cardId: string,
  state: ClientProjectState,
): FunnelBoardColumn[] {
  return board.map((col) => ({
    ...col,
    cards: col.cards.map((c) => (c.id === cardId ? { ...c, state } : c)),
  }));
}

/** Total de cards — o cabeçalho de cada coluna mostra a contagem. */
export function countCards(column: FunnelBoardColumn): number {
  return column.cards.length;
}

/** Iniciais para o avatar do cliente (referência visual do PI). */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/** Nome do cliente para exibir no card, com a empresa quando houver. */
export function cardSubtitle(card: FunnelCard): string {
  const { name, company } = card.client;
  return company ? `${name} · ${company}` : name;
}
