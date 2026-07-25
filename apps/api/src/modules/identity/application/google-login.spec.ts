import { AuthService, loginFromEmail } from './auth.service';
import type { PrismaService } from '../../../prisma/prisma.service';
import type { JwtService } from '@nestjs/jwt';
import type { CryptoService } from '../infrastructure/crypto.service';
import type { GithubOauthClient } from '../infrastructure/github-oauth.client';
import type { GoogleOauthClient, GoogleUser } from '../infrastructure/google-oauth.client';

/**
 * Login por Google (SPEC-026): a sessão deriva da identidade, não da conexão.
 *
 * O que se prova aqui é o critério de aceite mais caro da spec — o usuário
 * pré-existente (identidade-GitHub) **não pode perder projetos/tenant** ao
 * migrar. Se o casamento por email falhar, o primeiro login pós-deploy cria uma
 * conta vazia e o usuário perde o acesso ao que já era dele.
 */
const PERFIL: GoogleUser = {
  sub: 'google-sub-123',
  email: 'rodreisdev@gmail.com',
  email_verified: true,
  name: 'Rodrigo Reis',
  picture: 'https://lh3.googleusercontent.com/foto',
};

type UserRow = {
  id: string;
  login: string;
  githubId: bigint | null;
  googleId: string | null;
  email: string | null;
};

/** Prisma de mentira com uma tabela `users` em memória. */
function makePrisma(rows: UserRow[]) {
  const calls = { create: 0, update: 0 };
  const prisma = {
    user: {
      findFirst: ({ where }: { where: { OR: Array<Record<string, string>> } }) => {
        const found = rows.find((r) =>
          where.OR.some((cond) => {
            const [key, value] = Object.entries(cond)[0];
            return (r as unknown as Record<string, unknown>)[key] === value;
          }),
        );
        return Promise.resolve(found ?? null);
      },
      update: ({ where, data }: { where: { id: string }; data: Partial<UserRow> }) => {
        calls.update++;
        const row = rows.find((r) => r.id === where.id)!;
        Object.assign(row, data);
        return Promise.resolve(row);
      },
      create: ({ data }: { data: Partial<UserRow> }) => {
        calls.create++;
        const row = { id: 'novo-id', githubId: null, ...data } as UserRow;
        rows.push(row);
        return Promise.resolve(row);
      },
    },
  } as unknown as PrismaService;
  return { prisma, calls, rows };
}

function makeService(rows: UserRow[]) {
  const { prisma, calls } = makePrisma(rows);
  const google = {
    exchangeCode: () => Promise.resolve('access-token'),
    fetchUser: () => Promise.resolve(PERFIL),
  } as unknown as GoogleOauthClient;
  const jwt = {
    signAsync: (payload: { sub: string }) => Promise.resolve(`jwt-de-${payload.sub}`),
  } as unknown as JwtService;
  const service = new AuthService(
    prisma,
    jwt,
    {} as CryptoService,
    {} as GithubOauthClient,
    google,
  );
  return { service, calls, rows };
}

describe('loginFromEmail', () => {
  it('usa a parte local do email como rótulo de exibição', () => {
    expect(loginFromEmail('rodreisdev@gmail.com')).toBe('rodreisdev');
  });

  it('email sem @ vira o próprio valor (nunca string vazia)', () => {
    expect(loginFromEmail('semarroba')).toBe('semarroba');
  });
});

describe('AuthService.handleGoogleCallback (SPEC-026)', () => {
  it('conta nova: cria identidade sem nenhuma conexão GitHub', async () => {
    const { service, calls, rows } = makeService([]);

    const { jwt } = await service.handleGoogleCallback('code');

    expect(calls.create).toBe(1);
    expect(jwt).toBe('jwt-de-novo-id');
    expect(rows[0].githubId).toBeNull();
    expect(rows[0].googleId).toBe(PERFIL.sub);
    expect(rows[0].login).toBe('rodreisdev');
  });

  // O CRITÉRIO CARO: sem isto, o primeiro login pós-deploy órfã os projetos.
  it('usuário pré-existente (identidade-GitHub) migra pelo email, na MESMA linha', async () => {
    const antigo: UserRow = {
      id: 'user-antigo',
      login: 'RodReis',
      githubId: 80895n,
      googleId: null,
      email: 'rodreisdev@gmail.com',
    };
    const { service, calls, rows } = makeService([antigo]);

    const { jwt } = await service.handleGoogleCallback('code');

    expect(calls.create).toBe(0); // nenhuma conta nova = nada orfanado
    expect(calls.update).toBe(1);
    expect(rows).toHaveLength(1);
    expect(jwt).toBe('jwt-de-user-antigo');
    expect(rows[0].googleId).toBe(PERFIL.sub);
    expect(rows[0].githubId).toBe(80895n); // conexão GitHub preservada
    expect(rows[0].login).toBe('RodReis'); // handle conhecido não é trocado
  });

  it('segundo login: casa por googleId e não duplica a conta', async () => {
    const jaMigrado: UserRow = {
      id: 'user-antigo',
      login: 'RodReis',
      githubId: 80895n,
      googleId: PERFIL.sub,
      email: 'outro-email@exemplo.com',
    };
    const { service, calls, rows } = makeService([jaMigrado]);

    await service.handleGoogleCallback('code');

    expect(calls.create).toBe(0);
    expect(rows).toHaveLength(1);
  });
});
