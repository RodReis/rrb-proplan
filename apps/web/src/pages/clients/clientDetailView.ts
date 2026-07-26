/**
 * Lógica pura do detalhe do cliente (FIX #134). Fora do React pelo mesmo motivo
 * do `boardView.ts`: o que erra em silêncio aqui é o **rótulo do link** — dizer
 * "ativo" para um link expirado, ou oferecer "gerar" quando já existe um válido,
 * são defeitos que passam numa revisão visual.
 */
import type { BriefingLinkInfo, ClientProject } from '../../lib/api';

/** URL pública do briefing. O caminho é o do `BriefingPublicController` (`/b/:token`). */
export function briefingUrl(token: string, origin: string): string {
  return `${origin.replace(/\/$/, '')}/b/${token}`;
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
