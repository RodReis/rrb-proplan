/**
 * CI status derivado do último workflow run (SPEC-019, decisão 2 do PI).
 * Domínio PURO. Normaliza a resposta da Actions API num status estável e diz
 * se está "vermelho" (a regra que o radar conta).
 *
 * "CI vermelho" = `failure`/`timed_out`/`cancelled`. Ausência de CI
 * (`sem-ci`/`sem-run`) é NEUTRA — não inventa problema, não gera falso-positivo
 * (mesma lógica do "não documentado" da Fatia 13).
 */

export interface WorkflowRunResult {
  status: string | null; // completed | in_progress | queued | ...
  conclusion: string | null; // success | failure | timed_out | cancelled | ...
  denied: boolean;
}

/** Conclusões que contam como vermelho no radar. */
const RED_CONCLUSIONS = new Set(['failure', 'timed_out', 'cancelled']);

/**
 * Traduz o run bruto num status persistível:
 *  - sem permissão `Actions: read` → `sem-ci` (degradação, não erro).
 *  - repo sem nenhum run → `sem-run`.
 *  - run em andamento (sem conclusion) → `em-andamento`.
 *  - senão, a própria conclusion (`success`/`failure`/…).
 */
export function ciStatusOf(run: WorkflowRunResult): string {
  if (run.denied) return 'sem-ci';
  if (run.status === null) return 'sem-run';
  if (run.conclusion === null) return 'em-andamento';
  return run.conclusion;
}

/** O status é "vermelho" (atenção no radar)? Ausência de CI nunca é vermelho. */
export function ciIsRed(status: string | null): boolean {
  return status !== null && RED_CONCLUSIONS.has(status);
}
