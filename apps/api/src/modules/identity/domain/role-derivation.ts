/**
 * Derivação de papel a partir do GitHub (SPEC-022, emenda E2 — decisões 1, 3 e 4).
 *
 * O papel do usuário no tenant não é escolhido no ProPlan: ele DERIVA do acesso
 * que a pessoa já tem no GitHub. Isso evita um segundo sistema de convites; o
 * preço é acoplar o acesso ao GitHub, reversível no dia em que SSO entrar.
 *
 * Função pura: recebe o que o GitHub respondeu e o estado atual do tenant,
 * devolve o papel a gravar. Sem I/O — quem chama busca os dados.
 */

import { Role } from '@prisma/client';

/**
 * Papel de membership de organização, como `GET /orgs/{org}/memberships/{user}`
 * devolve. `null` = o usuário não é membro da org (ou a consulta não se aplica).
 *
 * Nota sobre `viewer`: a decisão 1 fala em "sem escrita → viewer", mas este
 * endpoint só distingue `admin` de `member` — permissão por repositório ficou
 * FORA deste corte, e é ela quem revelaria acesso somente-leitura. Então
 * `viewer` não é derivável aqui: quem é membro da org vira no mínimo `member`.
 * Rebaixar a `viewer` exigiria a permissão repo-scoped (fora do escopo E2).
 */
export type GithubOrgRole = 'admin' | 'member' | null;

export interface RoleDerivationInput {
  /** `User` = conta pessoal · `Organization` = org (decisão 3). */
  accountType: string;
  /** Resposta do GitHub. Irrelevante quando `accountType === 'User'`. */
  orgRole: GithubOrgRole;
  /** Papel gravado hoje no `Membership`. */
  currentRole: Role;
  /** Quantos `owner` o tenant tem AGORA, contando este usuário (decisão 4). */
  ownerCount: number;
}

export interface RoleDerivation {
  role: Role;
  /** true quando a guarda anti-rebaixamento impediu a queda de papel. */
  guarded: boolean;
}

/**
 * Papel derivado, com a guarda da decisão 4 aplicada.
 *
 * Regras, em ordem:
 * 1. Conta pessoal → o dono é SEMPRE `owner`, sem consultar o GitHub (decisão 3).
 * 2. Org: `admin`/`owner` no GitHub → `owner`; membro → `member`; não-membro →
 *    `viewer` (perdeu acesso: fica só com leitura, nunca é apagado).
 * 3. GUARDA (decisão 4): se o papel derivado REBAIXA um `owner` e ele é o
 *    ÚNICO do tenant, o `owner` permanece. Sem isso, o tenant ficaria sem
 *    ninguém que possa finalizar issue (ADR-011) — inclusive aceitar esta
 *    própria entrega. Um tenant sem owner é irrecuperável pela UI.
 */
export function deriveRole(input: RoleDerivationInput): RoleDerivation {
  const { accountType, orgRole, currentRole, ownerCount } = input;

  // Decisão 3: conta pessoal não tem "admin da org" — o dono é owner por
  // definição. Nenhum lookup no GitHub (o chamador nem consulta).
  if (accountType === 'User') return { role: 'owner', guarded: false };

  const derived: Role =
    orgRole === 'admin' ? 'owner' : orgRole === 'member' ? 'member' : 'viewer';

  // Decisão 4: a guarda só age quando o rebaixamento deixaria o tenant SEM
  // owner. Rebaixar um owner entre vários é legítimo — o tenant continua
  // administrável.
  const isDemotingOwner = currentRole === 'owner' && derived !== 'owner';
  if (isDemotingOwner && ownerCount <= 1) {
    return { role: 'owner', guarded: true };
  }

  return { role: derived, guarded: false };
}
