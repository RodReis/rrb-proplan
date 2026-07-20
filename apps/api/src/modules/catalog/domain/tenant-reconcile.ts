/**
 * Reconciliação de tenant↔instalação (SPEC-022, §Notas técnicas: "Reinstall
 * re-liga, não recria"). O id de instalação do GitHub NÃO é estável —
 * desinstalar e reinstalar o App emite um id novo. O `Tenant` tem PK própria
 * exatamente para absorver isso: o reinstall RE-APONTA `installationId` no
 * mesmo tenant, nunca cria um duplicado nem orfana projetos/settings.
 *
 * O casamento é pelo **id numérico da conta** (`accountId`), não pelo
 * `accountLogin`: o login muda num rename de conta e nos faria criar um tenant
 * duplicado — o próprio dano que este módulo existe para impedir. O id da conta
 * é o único identificador estável que o GitHub expõe aqui.
 *
 * Função pura: recebe os tenants conhecidos e as instalações visíveis agora,
 * devolve só as mudanças a persistir.
 */

export interface TenantInstallationState {
  id: string;
  installationId: number | null;
  accountId: number | null;
  accountLogin: string;
}

/** Instalação viva, como o GitHub a devolve em `GET /user/installations`. */
export interface VisibleInstallation {
  installationId: number;
  accountId: number;
  accountLogin: string;
}

export interface TenantRelink {
  tenantId: string;
  installationId: number;
  /** Preenche o `accountId` das linhas pré-migration, que nascem sem ele. */
  accountId: number;
  /** Acompanha o rename da conta: o login é rótulo de exibição, não chave. */
  accountLogin: string;
}

/**
 * Diff mínimo: só tenants cujo `installationId`, `accountId` ou `accountLogin`
 * mudou. Tenant sem instalação visível é deixado intacto — ausência aqui é
 * "não vi agora", nunca "não existe mais": desligar um tenant por silêncio
 * orfanaria os dados que este módulo protege.
 */
export function reconcileTenantInstallations(
  tenants: TenantInstallationState[],
  visible: VisibleInstallation[],
): TenantRelink[] {
  const byAccountId = new Map<number, VisibleInstallation>();
  for (const inst of visible) byAccountId.set(inst.accountId, inst);

  // Fallback por login: cobre APENAS as linhas pré-migration, que ainda não têm
  // `accountId`. Casar por login é frágil (rename), mas para essas linhas é a
  // única chave disponível — e o re-liga já grava o accountId, então cada
  // tenant passa por aqui no máximo uma vez.
  const byLogin = new Map<string, VisibleInstallation>();
  for (const inst of visible) byLogin.set(inst.accountLogin.toLowerCase(), inst);

  const relinks: TenantRelink[] = [];
  for (const t of tenants) {
    const match =
      t.accountId !== null
        ? byAccountId.get(t.accountId)
        : byLogin.get(t.accountLogin.toLowerCase());
    if (!match) continue;

    const changed =
      match.installationId !== t.installationId ||
      match.accountId !== t.accountId ||
      match.accountLogin !== t.accountLogin;
    if (!changed) continue;

    relinks.push({
      tenantId: t.id,
      installationId: match.installationId,
      accountId: match.accountId,
      accountLogin: match.accountLogin,
    });
  }
  return relinks;
}
