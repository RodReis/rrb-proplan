/**
 * Caminho **convencional** de cada aba de documento (CONVENTION.md).
 *
 * Usado só para o rótulo `AGUARDA <arquivo>` da faixa quando o doc não existe
 * (DESIGN.md §6): ausência é informação, e a informação útil é *de qual arquivo
 * esta aba se alimenta*.
 *
 * Não é imposição (ADR-014): o ProPlan se adapta ao repo — a resolução real é a
 * escada convenção → alias → `.proplan/config.yml` → ausente, e roda no
 * servidor. Aqui é só o primeiro degrau, para dizer ao dono o que criar se ele
 * quiser. O ProPlan nunca renomeia nem cria esse arquivo por conta própria.
 *
 * Espelha o `CONVENTION_PATH` de
 * `apps/api/src/modules/ingestion/domain/document-resolver.ts` — note que lá a
 * chave é a **entidade** (`testing`), aqui é o **id da aba** (`tests`). A cópia é
 * deliberada: expor o mapa exigiria endpoint novo, que a SPEC-020 põe fora de
 * escopo ("sem endpoint novo"). Se divergir, o servidor é a verdade.
 *
 * Abas sem entidade no resolver (Contexto, Handoff) ficam fora: não têm caminho
 * convencional a anunciar, e inventar um seria impor convenção (ADR-014).
 */
const CONVENTION_PATH: Record<string, string> = {
  architecture: 'docs/ARCHITECTURE.md',
  decisions: 'docs/DECISIONS.md',
  design: 'docs/DESIGN.md',
  tests: 'docs/TESTING.md',
  deploy: 'docs/DEPLOY.md',
  skills: 'CLAUDE.md',
};

export function conventionPathOf(tabId: string): string | null {
  return CONVENTION_PATH[tabId] ?? null;
}
