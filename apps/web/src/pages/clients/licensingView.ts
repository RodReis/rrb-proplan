import type { LicenseStatus, LicenseView } from '../../lib/api';

/**
 * Lógica de apresentação da tela de Licenças (SPEC-036).
 *
 * Fora do componente pelo motivo de sempre nesta casa: o que decide o que a
 * tela **afirma** deve ser testável sem montar React.
 */

/** Rótulo em português do status. */
export function statusLabel(status: LicenseStatus): string {
  if (status === 'ACTIVE') return 'Ativa';
  if (status === 'REVOKED') return 'Revogada';
  return 'Expirada';
}

/**
 * Tom do badge. `REVOKED` e `EXPIRED` compartilham o tom de alerta porque, do
 * ponto de vista de quem olha, os dois querem dizer a mesma coisa: **esta chave
 * não ativa mais**. O texto distingue o motivo; a cor não precisa.
 */
export function statusTone(status: LicenseStatus): 'ok' | 'alert' {
  return status === 'ACTIVE' ? 'ok' : 'alert';
}

/**
 * `2 de 2 máquinas`. Não usa barra de progresso nem porcentagem: com teto de 2,
 * uma barra transformaria "uma máquina ativada" em "50%", que é precisão
 * inventada sobre um número que cabe por extenso.
 */
export function machinesLabel(licenca: LicenseView): string {
  return `${licenca.activeMachines} de ${licenca.maxMachines} ${
    licenca.maxMachines === 1 ? 'máquina' : 'máquinas'
  }`;
}

/** `true` quando não cabe mais máquina — a próxima ativação recebe 409. */
export function isAtMachineLimit(licenca: LicenseView): boolean {
  return licenca.activeMachines >= licenca.maxMachines;
}

/**
 * Data curta e local. `—` para nulo, nunca a string "null" nem data vazia: a
 * ausência é informação (ADR-014) e precisa parecer ausência.
 */
export function shortDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('pt-BR');
}

export function shortDateTime(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return `${d.toLocaleDateString('pt-BR')} ${d.toLocaleTimeString('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
  })}`;
}

/**
 * Estado da janela de updates.
 *
 * **`updatesUntil` vencido não impede o produto de rodar** — a licença perpétua
 * continua válida (MVP4 decisão 3); o que vence é o direito a versões novas.
 * O rótulo tem de dizer isso, porque "expirado" sozinho faria o suporte
 * acreditar que a licença morreu.
 */
export function updatesLabel(licenca: LicenseView, agora: Date = new Date()): string {
  const fim = new Date(licenca.updatesUntil);
  if (Number.isNaN(fim.getTime())) return '—';
  return fim.getTime() > agora.getTime()
    ? `Updates até ${shortDate(licenca.updatesUntil)}`
    : `Updates encerrados em ${shortDate(licenca.updatesUntil)}`;
}

/**
 * Rótulo dos eventos da trilha.
 *
 * **Tipo desconhecido cai no próprio nome cru, em vez de sumir.** É a mesma
 * regra da trilha do dashboard (Fatia 24): as fatias 27–28 acrescentam tipos
 * (`webhook_renewed`, `source_invited`), e uma lista que omite o que não
 * reconhece mente por omissão.
 */
const EVENTOS: Record<string, string> = {
  issued: 'Licença emitida',
  activated: 'Máquina ativada',
  reactivated: 'Máquina reativada',
  revoked: 'Licença revogada',
  // SPEC-037
  heartbeat: 'Sinal da máquina',
  deactivated: 'Máquina desativada',
  deactivated_by_admin: 'Máquina desativada pelo suporte',
};

export function eventLabel(type: string): string {
  return EVENTOS[type] ?? type;
}

/**
 * O que a busca deve fazer com o texto digitado.
 *
 * A tela tem **um** campo, não dois: quem usa é o suporte com a chave que o
 * comprador mandou, ou com o e-mail dele. Exigir que escolha o tipo antes de
 * digitar seria burocracia sobre a informação que ele já tem na mão.
 *
 * `@` decide. Não há ambiguidade real: chave não tem arroba, e-mail sempre tem.
 */
export function searchMode(texto: string): { email?: string; key?: string } | null {
  const t = texto.trim();
  if (!t) return null;
  return t.includes('@') ? { email: t } : { key: t };
}

/**
 * Rótulo de uma máquina na lista do admin (SPEC-037).
 *
 * `hostname` é opcional e vem da máquina do comprador; sem ele, o fingerprint
 * abreviado é o que resta para distinguir uma da outra. Mostrar o fingerprint
 * inteiro seria ruído — ele é um hash, e ninguém o lê por extenso.
 */
export function machineLabel(a: { hostname: string | null; fingerprint: string }): string {
  return a.hostname ?? `máquina ${a.fingerprint.slice(0, 8)}…`;
}

/**
 * Estado da máquina, em texto.
 *
 * **`lastSeenAt` não vira "online/offline".** O heartbeat é diário (24 h ± 2 h);
 * chamar de "offline" quem bateu há 25 h afirmaria uma queda que não houve — e
 * a licença continua válida por 14 dias de graça, independentemente disso.
 */
export function machineStatus(a: { deactivatedAt: string | null }): 'ativa' | 'desativada' {
  return a.deactivatedAt ? 'desativada' : 'ativa';
}

/**
 * O contador de trocas, quando vale a pena dizer algo.
 *
 * `null` abaixo do piso: **duas trocas em 30 dias é vida normal** — formatar o
 * PC, trocar de notebook. Mostrar um número em toda licença treinaria o olho a
 * ignorá-lo, que é o oposto do que um sinal serve para fazer (decisão 1 do PI:
 * é sinal, não limite).
 */
export function swapSignal(
  detalhe: { swapCount: number; swapWindowDays: number },
  piso = 4,
): string | null {
  if (detalhe.swapCount < piso) return null;
  return `${detalhe.swapCount} trocas em ${detalhe.swapWindowDays} dias`;
}
