import { UnauthorizedException } from '@nestjs/common';
import { GithubAuth, REFRESH_MARGIN_MS, needsRefresh } from './github-auth.service';

describe('needsRefresh', () => {
  const now = new Date('2026-07-12T12:00:00Z');

  it('renova quando não há data de expiração', () => {
    expect(needsRefresh(null, now)).toBe(true);
  });

  it('renova quando falta menos que a margem', () => {
    const soon = new Date(now.getTime() + REFRESH_MARGIN_MS - 1000);
    expect(needsRefresh(soon, now)).toBe(true);
  });

  it('não renova quando falta bastante', () => {
    const later = new Date(now.getTime() + 60 * 60 * 1000);
    expect(needsRefresh(later, now)).toBe(false);
  });
});

function build(overrides: Partial<Record<string, unknown>> = {}) {
  const user = {
    id: 'u1',
    encryptedUserToken: 'enc-user',
    encryptedRefreshToken: 'enc-refresh',
    tokenExpiresAt: new Date(Date.now() + 60 * 60 * 1000), // longe de expirar
    ...(overrides.user as object),
  };
  const prisma = {
    user: {
      findUnique: jest.fn(async () => user),
      update: jest.fn(async () => user),
    },
    project: {
      findUnique: jest.fn(async () => overrides.project ?? null),
    },
  };
  const crypto = {
    decrypt: jest.fn((v: string) => v.replace('enc-', 'dec-')),
    encrypt: jest.fn((v: string) => `enc-${v}`),
  };
  const oauth = {
    refresh: jest.fn(async () => ({
      accessToken: 'novo-access',
      refreshToken: 'novo-refresh',
      expiresAt: new Date(Date.now() + 8 * 3600 * 1000),
    })),
  };
  const installations = { list: jest.fn(async () => []) };
  const installationTokens = { tokenFor: jest.fn(async () => 'ghs_inst') };
  const svc = new GithubAuth(
    prisma as never,
    crypto as never,
    oauth as never,
    installations as never,
    installationTokens as never,
  );
  return { svc, prisma, crypto, oauth, installationTokens };
}

describe('GithubAuth.userToken', () => {
  it('token válido: decripta sem chamar refresh', async () => {
    const { svc, oauth, crypto } = build();
    const token = await svc.userToken('u1');
    expect(token).toBe('dec-user');
    expect(oauth.refresh).not.toHaveBeenCalled();
    expect(crypto.decrypt).toHaveBeenCalledWith('enc-user');
  });

  it('token perto de expirar: renova e persiste os novos tokens', async () => {
    const { svc, oauth, prisma } = build({
      user: { tokenExpiresAt: new Date(Date.now() + 1000) },
    });
    const token = await svc.userToken('u1');
    expect(token).toBe('novo-access');
    expect(oauth.refresh).toHaveBeenCalledWith('dec-refresh');
    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          encryptedUserToken: 'enc-novo-access',
          encryptedRefreshToken: 'enc-novo-refresh',
        }),
      }),
    );
  });

  it('falha do refresh derruba a sessão (nunca 401 cru)', async () => {
    const { svc, oauth } = build({
      user: { tokenExpiresAt: new Date(Date.now() + 1000) },
    });
    oauth.refresh.mockRejectedValueOnce(new Error('refresh negado'));
    await expect(svc.userToken('u1')).rejects.toBeInstanceOf(UnauthorizedException);
  });
});

describe('GithubAuth.installationToken', () => {
  it('projeto com instalação ativa: devolve o installation token', async () => {
    const { svc, installationTokens } = build({
      project: { installationId: 55, installationStatus: 'active' },
    });
    const token = await svc.installationToken('p1');
    expect(token).toBe('ghs_inst');
    expect(installationTokens.tokenFor).toHaveBeenCalledWith(55);
  });

  it('projeto sem instalação: erro (nunca escreve sem bot)', async () => {
    const { svc } = build({
      project: { installationId: null, installationStatus: 'missing' },
    });
    await expect(svc.installationToken('p1')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });
});
