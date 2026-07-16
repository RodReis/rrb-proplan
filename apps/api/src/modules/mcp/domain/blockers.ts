/**
 * `find_blockers` (SPEC-016) — julgamento derivado PURO: o que trava cada frente.
 *
 * Um blocker é uma evidência já calculada por fatias anteriores, reprojetada como
 * "isto impede avançar":
 *   - constraint marcada `a-revalidar` (Fatia 10): o fosso pede confirmação antes
 *     de mexer no que ela protege (ADR-013);
 *   - campo canônico em recusa numa entidade estrutural (architecture/decisions):
 *     decisão ausente/defasada trava quem depende dela (Fatia 9).
 *
 * Não reinfere nada — só reprojeta o que 9/10 persistiram. Se não há blocker,
 * a lista é vazia (e a tool, sem evidência, recusa — contrato).
 */

export interface ConstraintView {
  statement: string;
  paths: string[];
  status: 'vigente' | 'a-revalidar';
  url?: string;
  date?: string | null;
  sha?: string;
  author?: string;
}

export interface RefusedField {
  entity: string;
  field: string;
  /** path/paths do que falta confirmar (vira a evidência do blocker). */
  missing: unknown;
}

export interface Blocker {
  kind: 'restrição-a-revalidar' | 'decisão-ausente';
  /** O que trava, em linguagem de gente. */
  what: string;
  /** Referência à fonte — path/URL, nunca corpo (ADR-017). */
  where: { paths: string[]; url?: string };
  status?: 'a-revalidar';
}

/** Entidades cuja recusa é um bloqueio real (não ruído de doc secundário). */
const BLOCKING_ENTITIES = new Set(['architecture', 'decisions']);

export function findBlockers(
  constraints: ConstraintView[],
  refusedFields: RefusedField[],
): Blocker[] {
  const fromConstraints: Blocker[] = constraints
    .filter((c) => c.status === 'a-revalidar')
    .map((c) => ({
      kind: 'restrição-a-revalidar' as const,
      what: c.statement,
      where: { paths: c.paths, url: c.url },
      status: 'a-revalidar' as const,
    }));

  const fromFields: Blocker[] = refusedFields
    .filter((f) => BLOCKING_ENTITIES.has(f.entity))
    .map((f) => ({
      kind: 'decisão-ausente' as const,
      what: `${f.entity} · ${f.field}: ausente ou defasado`,
      where: { paths: pathsOf(f.missing) },
    }));

  return [...fromConstraints, ...fromFields];
}

function pathsOf(missing: unknown): string[] {
  if (missing && typeof missing === 'object') {
    const m = missing as Record<string, unknown>;
    if (Array.isArray(m.paths)) return m.paths.filter((p): p is string => typeof p === 'string');
    if (typeof m.path === 'string') return [m.path];
  }
  return [];
}
