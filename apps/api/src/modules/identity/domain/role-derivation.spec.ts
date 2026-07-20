import { deriveRole, RoleDerivationInput } from './role-derivation';

const input = (over: Partial<RoleDerivationInput> = {}): RoleDerivationInput => ({
  accountType: 'Organization',
  orgRole: 'member',
  currentRole: 'member',
  ownerCount: 2,
  ...over,
});

describe('deriveRole', () => {
  describe('org: papel deriva da permissão do GitHub (decisão 1)', () => {
    it('admin da org → owner', () => {
      expect(deriveRole(input({ orgRole: 'admin' })).role).toBe('owner');
    });

    it('membro da org (não-admin) → member', () => {
      expect(deriveRole(input({ orgRole: 'member' })).role).toBe('member');
    });

    it('não-membro → viewer (perdeu acesso, fica só com leitura)', () => {
      // O critério "remover acesso no GitHub → o papel cai". Não apaga o
      // Membership: o histórico do usuário no tenant continua existindo.
      expect(deriveRole(input({ orgRole: null, currentRole: 'member' })).role).toBe(
        'viewer',
      );
    });

    it('o papel CAI quando o acesso some — owner vira viewer (havendo outro owner)', () => {
      const out = deriveRole(
        input({ orgRole: null, currentRole: 'owner', ownerCount: 2 }),
      );
      expect(out).toEqual({ role: 'viewer', guarded: false });
    });
  });

  describe('tenant pessoal: dono é owner por definição (decisão 3)', () => {
    it('accountType User → owner, mesmo com orgRole null', () => {
      // O carve-out que importa: conta pessoal não tem "admin da org". Sem
      // isto, o único caso vivo em produção hoje cairia para viewer.
      const out = deriveRole(
        input({ accountType: 'User', orgRole: null, currentRole: 'owner' }),
      );
      expect(out).toEqual({ role: 'owner', guarded: false });
    });

    it('accountType User → owner mesmo se o papel atual for viewer', () => {
      expect(
        deriveRole(input({ accountType: 'User', orgRole: null, currentRole: 'viewer' }))
          .role,
      ).toBe('owner');
    });
  });

  describe('guarda anti-rebaixamento (decisão 4)', () => {
    it('NÃO rebaixa o único owner do tenant — o papel permanece', () => {
      // O cenário que a decisão 4 existe para impedir: sem a guarda, o tenant
      // ficaria sem ninguém capaz de finalizar issue (ADR-011) e seria
      // irrecuperável pela UI.
      const out = deriveRole(
        input({ orgRole: null, currentRole: 'owner', ownerCount: 1 }),
      );
      expect(out).toEqual({ role: 'owner', guarded: true });
    });

    it('guarda também protege quando o GitHub diz "member" (rebaixamento parcial)', () => {
      const out = deriveRole(
        input({ orgRole: 'member', currentRole: 'owner', ownerCount: 1 }),
      );
      expect(out).toEqual({ role: 'owner', guarded: true });
    });

    it('rebaixa owner quando HÁ outro owner — a guarda não é um trava-tudo', () => {
      // O tenant continua administrável, então o rebaixamento é legítimo.
      const out = deriveRole(
        input({ orgRole: 'member', currentRole: 'owner', ownerCount: 3 }),
      );
      expect(out).toEqual({ role: 'member', guarded: false });
    });

    it('a guarda não PROMOVE ninguém — só impede queda', () => {
      // member que perdeu acesso vira viewer normalmente, mesmo com o tenant
      // tendo zero owners: a guarda protege quem já é owner, não inventa um.
      const out = deriveRole(
        input({ orgRole: null, currentRole: 'member', ownerCount: 0 }),
      );
      expect(out).toEqual({ role: 'viewer', guarded: false });
    });
  });

  it('promoção não é afetada pela guarda: member → owner quando vira admin', () => {
    const out = deriveRole(
      input({ orgRole: 'admin', currentRole: 'member', ownerCount: 1 }),
    );
    expect(out).toEqual({ role: 'owner', guarded: false });
  });
});
