import type { ResolvedRoute } from '../../lib/api';

/** Token da URL casa com a resolução (slug, uuid ou slug em outra caixa). */
function matches(token: string | undefined, slug: string, id: string): boolean {
  return token === slug || token === id || token?.toLowerCase() === slug;
}

/**
 * URL canônica para `(tenant, project)` da URL, ou `null` quando não há nada a
 * reescrever (SPEC-028).
 *
 * Devolve `null` também quando a resolução **não corresponde** aos tokens atuais
 * da URL. Essa é a guarda contra a corrida que quebrava a troca de projeto pelo
 * combo: o efeito de canonização roda com o `project` já novo e a resolução
 * ainda velha, e sem o descarte reescrevia a URL de volta para o projeto
 * anterior — a troca "piscava e voltava" (SPEC-020 §1).
 */
export function canonicalUrl(
  resolved: ResolvedRoute,
  tenant: string | undefined,
  project: string | undefined,
  tab: string | undefined,
  suffixes: string = '',
): string | null {
  const { tenantId, projectId, tenantSlug, projectSlug } = resolved;
  // Resolução obsoleta: não é sobre esta URL, então não manda nela.
  if (!matches(tenant, tenantSlug, tenantId)) return null;
  if (!matches(project, projectSlug, projectId)) return null;
  // Já canônica.
  if (tenant === tenantSlug && project === projectSlug) return null;
  const suffix = tab ? `/${tab}` : '';
  return `/t/${tenantSlug}/p/${projectSlug}${suffix}${suffixes}`;
}
