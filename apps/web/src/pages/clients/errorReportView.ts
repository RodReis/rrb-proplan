import type { LicErrorReportView, LicErrorStatus } from '../../lib/api';

/**
 * As decisões de exibição da aba de erros (SPEC-043), como funções puras.
 *
 * Vivem fora do componente pelo mesmo motivo do `licensingView`: são regras
 * testáveis sem montar React, e o painel fica só com o que é layout.
 */

export function errorStatusLabel(status: LicErrorStatus): string {
  if (status === 'TRIAGED') return 'em análise';
  if (status === 'RESOLVED') return 'resolvido';
  return 'novo';
}

/**
 * `NEW` é o único que pede ação, e por isso é o único com cor de alerta.
 *
 * A regra do DESIGN.md §1 vale aqui: cor carrega significado, não decoração.
 * Pintar `TRIAGED` de amarelo diria "isto também está pendente" sobre algo que
 * alguém já pegou.
 */
export function errorStatusTone(status: LicErrorStatus): 'ok' | 'alert' | 'muted' {
  if (status === 'RESOLVED') return 'ok';
  if (status === 'NEW') return 'alert';
  return 'muted';
}

export function sourceLabel(source: 'CRASH' | 'MANUAL'): string {
  return source === 'MANUAL' ? 'enviado pelo usuário' : 'crash automático';
}

/** Quantos ainda ninguém olhou — o número que a aba mostra na etiqueta. */
export function newCount(relatos: LicErrorReportView[]): number {
  return relatos.filter((r) => r.status === 'NEW').length;
}

/**
 * O próximo estado do botão de triagem.
 *
 * `NEW → TRIAGED → RESOLVED`, e `RESOLVED` volta para `NEW`: reabrir é o caso
 * real (o bug voltou), e sem a volta o operador precisaria de um segundo
 * controle para desfazer um clique errado.
 */
export function nextStatus(atual: LicErrorStatus): LicErrorStatus {
  if (atual === 'NEW') return 'TRIAGED';
  if (atual === 'TRIAGED') return 'RESOLVED';
  return 'NEW';
}

export function nextStatusLabel(atual: LicErrorStatus): string {
  if (atual === 'NEW') return 'Analisar';
  if (atual === 'TRIAGED') return 'Resolver';
  return 'Reabrir';
}

/**
 * As versões presentes nos relatos, mais nova primeiro pela ordem em que
 * apareceram. Alimenta o filtro sem exigir uma rota nova só para listá-las.
 *
 * Ordena por `receivedAt` e não por semver: `appVersion` é a string que o app
 * mandou, e inventar ordenação semver aqui criaria uma segunda noção de "mais
 * nova", divergente da que o resto da área usa.
 */
export function versionsOf(relatos: LicErrorReportView[]): string[] {
  const vistas = [...relatos]
    .sort((a, b) => b.receivedAt.localeCompare(a.receivedAt))
    .map((r) => r.appVersion);
  return [...new Set(vistas)];
}

/**
 * O `sessionTail` formatado para leitura.
 *
 * **Nunca `dangerouslySetInnerHTML`**: o conteúdo vem da máquina de outra
 * pessoa, por uma rota pública. Texto puro em `<pre>` é o que impede que um
 * relato de erro vire vetor de XSS na tela do operador.
 */
export function sessionTailText(valor: unknown): string | null {
  if (valor === null || valor === undefined) return null;
  if (typeof valor === 'string') return valor;
  try {
    return JSON.stringify(valor, null, 2);
  } catch {
    return null;
  }
}
