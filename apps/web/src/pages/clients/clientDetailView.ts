/**
 * Lógica pura do detalhe do cliente (FIX #134). Fora do React pelo mesmo motivo
 * do `boardView.ts`: o que erra em silêncio aqui é o **rótulo do link** — dizer
 * "ativo" para um link expirado, ou oferecer "gerar" quando já existe um válido,
 * são defeitos que passam numa revisão visual.
 */
import type { BriefingLinkInfo, BriefingStatus, ClientProject } from '../../lib/api';

/**
 * URL pública do briefing, entregue **ao cliente do prestador**.
 *
 * Aponta para a **web** (`proplan.rrbtrading.com.br/b/<token>`), que tem a rota
 * pública `/b/:token` desde o FIX #136 — ela consulta a API e mostra o estado do
 * link numa página legível.
 *
 * Este endereço já teve duas versões erradas, e a razão de ambas é a mesma —
 * havia rota no backend e não no frontend:
 *
 * 1. `window.location.origin` **sem** a rota no React → o catch-all mandava o
 *    visitante para a tela de login;
 * 2. `API_URL` → respondia, mas devolvia `{"status":"valid"}` cru num host
 *    chamado `api.`, que para o destinatário parece link quebrado.
 *
 * Trocar a base era remendo; a correção foi criar a rota que faltava. Agora o
 * endereço é **definitivo**: quando o formulário da Fatia 20 (SPEC-031) chegar,
 * ele substitui o conteúdo da mesma rota e nenhum link enviado quebra.
 */
export function briefingUrl(token: string, webOrigin: string): string {
  return `${webOrigin.replace(/\/$/, '')}/b/${token}`;
}

export type LinkState = 'nenhum' | 'valido' | 'expirado' | 'revogado';

/**
 * O estado do link como a UI deve falar dele.
 *
 * `active: false` e `status: 'invalid'` colapsam em **nenhum**: para quem olha a
 * tela, "não existe" e "existe mas não vale nada" pedem a mesma ação — gerar um
 * novo. Distinguir os dois só produziria um rótulo que ninguém sabe interpretar.
 */
export function linkStateOf(info: BriefingLinkInfo | null): LinkState {
  if (!info || !info.active) return 'nenhum';
  if (info.status === 'revoked') return 'revogado';
  if (info.status === 'expired') return 'expirado';
  if (info.status === 'valid') return 'valido';
  return 'nenhum';
}

export const LINK_STATE_LABEL: Record<LinkState, string> = {
  nenhum: 'sem link',
  valido: 'link ativo',
  expirado: 'link expirado',
  revogado: 'link revogado',
};

/**
 * O rótulo do botão de gerar. Regenerar **revoga o anterior** (SPEC-029), então
 * a palavra tem de mudar: quem vê "Gerar link" não espera invalidar o que já
 * mandou para o cliente.
 */
export function generateLabel(state: LinkState): string {
  return state === 'nenhum' ? 'Gerar link' : 'Regenerar link';
}

/** Revogar só faz sentido sobre um link que ainda pode ser usado. */
export function canRevoke(state: LinkState): boolean {
  return state === 'valido';
}

/**
 * Ordena os projetos do detalhe: mais recente primeiro. `createdAt` é ISO-8601,
 * que ordena como string — sem `new Date()` para cada comparação.
 */
export function sortProjects(projects: ClientProject[]): ClientProject[] {
  return [...projects].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/**
 * Valida o título antes de chamar a API. Só o obrigatório — o servidor valida de
 * novo, isto é para o botão não disparar request que já se sabe que falha.
 */
export function isValidTitle(title: string): boolean {
  return title.trim().length > 0;
}

/**
 * O estado do briefing como a gaveta fala dele (SPEC-031 §6): *não iniciado ·
 * em preenchimento com % de etapas · recebido em data*.
 *
 * Fora do React pelo mesmo motivo do rótulo do link: dizer "recebido" para um
 * briefing que ninguém enviou é o tipo de defeito que passa numa revisão visual.
 *
 * `receivedAt` chega em ISO com `Z` e a data sai no fuso de quem lê — recortar a
 * string mostraria o dia seguinte para um envio das 22h no Brasil.
 */
export function briefingStateLabel(status: BriefingStatus | null): string {
  if (!status) return 'briefing não iniciado';

  if (status.state === 'received') {
    const date = status.receivedAt ? new Date(status.receivedAt) : null;
    return date && !Number.isNaN(date.getTime())
      ? `briefing recebido em ${date.toLocaleDateString('pt-BR')}`
      : 'briefing recebido';
  }

  if (status.state === 'in_progress') {
    return `briefing em preenchimento · ${status.completedSteps ?? 0} de ${status.totalSteps}`;
  }

  return 'briefing não iniciado';
}
