import { AuthService } from './auth.service';
import type { PrismaService } from '../../../prisma/prisma.service';
import type { JwtService } from '@nestjs/jwt';
import type { CryptoService } from '../infrastructure/crypto.service';
import type { GithubOauthClient } from '../infrastructure/github-oauth.client';
import type { GoogleOauthClient } from '../infrastructure/google-oauth.client';

/**
 * Conexão GitHub como entidade própria (SPEC-025).
 *
 * O critério caro aqui é *desconectar ≠ deslogar*: a linha de `Connection` some
 * e o `User` — com projetos e tenants — fica de pé. O outro é a **revogação
 * real**: apagar o token do nosso lado sem avisar o GitHub deixaria a
 * autorização viva lá, contrariando "seus dados continuam seus" da spec.
 */

type ConnectionRow = {
  id: string;
  userId: string;
  provider: string;
  encryptedUserToken: string | null;
  encryptedRefreshToken: string | null;
  tokenExpiresAt: Date | null;
};

type UserRow = { id: string; login: string; githubId: bigint | null };

function makeDeps(
  opts: {
    connections?: ConnectionRow[];
    users?: UserRow[];
    /** Faz a revogação no GitHub falhar (token morto, App desinstalado). */
    revokeFalha?: boolean;
  } = {},
) {
  const connections = opts.connections ?? [];
  const users = opts.users ?? [{ id: 'u1', login: 'RodReis', githubId: 80895n }];
  const revoked: string[] = [];

  const find = (userId: string, provider: string) =>
    connections.find((c) => c.userId === userId && c.provider === provider) ?? null;

  const prisma = {
    connection: {
      findUnique: ({
        where,
      }: {
        where: { userId_provider: { userId: string; provider: string } };
      }) =>
        Promise.resolve(
          find(where.userId_provider.userId, where.userId_provider.provider),
        ),
      upsert: ({
        where,
        create,
        update,
      }: {
        where: { userId_provider: { userId: string; provider: string } };
        create: Partial<ConnectionRow>;
        update: Partial<ConnectionRow>;
      }) => {
        const existing = find(
          where.userId_provider.userId,
          where.userId_provider.provider,
        );
        if (existing) {
          Object.assign(existing, update);
          return Promise.resolve(existing);
        }
        const row = { id: 'nova-conexao', ...create } as ConnectionRow;
        connections.push(row);
        return Promise.resolve(row);
      },
      delete: ({ where }: { where: { id: string } }) => {
        const i = connections.findIndex((c) => c.id === where.id);
        const [removed] = connections.splice(i, 1);
        return Promise.resolve(removed);
      },
    },
    user: {
      update: ({ where, data }: { where: { id: string }; data: Partial<UserRow> }) => {
        const row = users.find((u) => u.id === where.id)!;
        Object.assign(row, data);
        return Promise.resolve(row);
      },
      upsert: ({ create }: { create: Partial<UserRow> }) => {
        const row = { id: 'novo-user', ...create } as UserRow;
        users.push(row);
        return Promise.resolve(row);
      },
    },
  } as unknown as PrismaService;

  const github = {
    exchangeCode: () =>
      Promise.resolve({
        accessToken: 'gho_novo',
        refreshToken: 'ghr_novo',
        expiresAt: new Date('2026-08-01T00:00:00Z'),
      }),
    fetchUser: () =>
      Promise.resolve({
        id: 80895,
        login: 'RodReis',
        name: 'Rodrigo Reis',
        avatar_url: 'https://avatars/x',
      }),
    revoke: (token: string) => {
      if (opts.revokeFalha) return Promise.reject(new Error('401 do GitHub'));
      revoked.push(token);
      return Promise.resolve();
    },
  } as unknown as GithubOauthClient;

  const crypto = {
    encrypt: (v: string) => `enc-${v}`,
    decrypt: (v: string) => v.replace('enc-', ''),
  } as unknown as CryptoService;

  const jwt = {
    signAsync: (p: { sub: string }) => Promise.resolve(`jwt-de-${p.sub}`),
  } as unknown as JwtService;

  const svc = new AuthService(
    prisma,
    jwt,
    crypto,
    github,
    {} as unknown as GoogleOauthClient,
  );
  return { svc, connections, users, revoked };
}

const CONEXAO_VIVA: ConnectionRow = {
  id: 'c1',
  userId: 'u1',
  provider: 'github',
  encryptedUserToken: 'enc-gho_antigo',
  encryptedRefreshToken: 'enc-ghr_antigo',
  tokenExpiresAt: new Date('2026-07-26T00:00:00Z'),
};

describe('AuthService.disconnectGithub', () => {
  it('revoga no GitHub e apaga a conexão', async () => {
    const { svc, connections, revoked } = makeDeps({
      connections: [{ ...CONEXAO_VIVA }],
    });

    await svc.disconnectGithub('u1');

    expect(revoked).toEqual(['gho_antigo']);
    expect(connections).toHaveLength(0);
  });

  it('mantém o usuário: desconectar não é deslogar', async () => {
    const { svc, users } = makeDeps({ connections: [{ ...CONEXAO_VIVA }] });

    await svc.disconnectGithub('u1');

    // O critério da SPEC-025: a identidade sobrevive à queda da conexão.
    expect(users).toHaveLength(1);
    expect(users[0].id).toBe('u1');
  });

  it('GitHub recusa a revogação: a conexão cai localmente mesmo assim', async () => {
    // Sem isto o usuário ficaria preso a uma conexão que mandou remover.
    const { svc, connections } = makeDeps({
      connections: [{ ...CONEXAO_VIVA }],
      revokeFalha: true,
    });

    await expect(svc.disconnectGithub('u1')).resolves.toBeUndefined();
    expect(connections).toHaveLength(0);
  });

  it('sem conexão: é no-op, não estoura', async () => {
    const { svc, revoked } = makeDeps({ connections: [] });

    await expect(svc.disconnectGithub('u1')).resolves.toBeUndefined();
    expect(revoked).toEqual([]);
  });
});

describe('AuthService.handleCallback (conectar vs logar)', () => {
  it('com sessão ativa: pendura a conexão no usuário logado', async () => {
    const { svc, connections, users } = makeDeps({
      users: [{ id: 'u-google', login: 'rodreisdev', githubId: null }],
    });

    const { jwt } = await svc.handleCallback('code', 'u-google');

    // A sessão continua a mesma — conectar não troca de identidade.
    expect(jwt).toBe('jwt-de-u-google');
    expect(users).toHaveLength(1);
    expect(connections).toHaveLength(1);
    expect(connections[0].userId).toBe('u-google');
    expect(connections[0].encryptedUserToken).toBe('enc-gho_novo');
  });

  it('conectar não sobrescreve o rótulo vindo do IdP', async () => {
    const { svc, users } = makeDeps({
      users: [{ id: 'u-google', login: 'rodreisdev', githubId: null }],
    });

    await svc.handleCallback('code', 'u-google');

    // `login` é do IdP; só o `githubId` é carimbado pela conexão.
    expect(users[0].login).toBe('rodreisdev');
    expect(users[0].githubId).toBe(80895n);
  });

  it('sem sessão: login legado pelo GitHub segue funcionando', async () => {
    const { svc, connections } = makeDeps({ users: [] });

    const { jwt } = await svc.handleCallback('code');

    expect(jwt).toBe('jwt-de-novo-user');
    expect(connections).toHaveLength(1);
  });

  it('reconectar reusa a linha em vez de duplicar', async () => {
    const { svc, connections } = makeDeps({ connections: [{ ...CONEXAO_VIVA }] });

    await svc.handleCallback('code', 'u1');

    // `1:N no schema, 1 na UI` — o unique(userId, provider) não pode virar erro
    // quando o usuário reconecta depois de desconectar e voltar.
    expect(connections).toHaveLength(1);
    expect(connections[0].encryptedUserToken).toBe('enc-gho_novo');
  });
});

describe('AuthService.githubConnection', () => {
  it('com conexão: connected true', async () => {
    const { svc } = makeDeps({ connections: [{ ...CONEXAO_VIVA }] });
    await expect(svc.githubConnection('u1')).resolves.toEqual({ connected: true });
  });

  it('sem conexão: connected false', async () => {
    const { svc } = makeDeps({ connections: [] });
    await expect(svc.githubConnection('u1')).resolves.toEqual({ connected: false });
  });
});
