import { UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { JwtAuthGuard } from './jwt-auth.guard';

/**
 * O guard que protege TODA rota autenticada.
 *
 * Ganhou um segundo caminho com o bypass de DEV (decisão do PI, 2026-07-27), e
 * é por isso que estes testes existem: até aqui o guard não tinha teste próprio
 * — a suíte verde não provava que ele recusa. Com dois caminhos, o risco de um
 * deles abrir sem querer deixou de ser hipotético.
 *
 * O bypass é lido no CONSTRUTOR (uma vez, no boot), então cada teste monta o
 * guard com o `process.env` que quer exercitar e o restaura depois.
 */

const USER = 'ca08cd44-443c-440e-91d5-72f5c996628d';

function contextWith(cookies: Record<string, string> = {}) {
  const req: Record<string, unknown> = { cookies };
  return {
    ctx: {
      switchToHttp: () => ({ getRequest: () => req }),
    } as never,
    req,
  };
}

/** Monta o guard com um env específico e restaura o original depois. */
function guardWith(env: Record<string, string | undefined>, jwt: JwtService) {
  const original = { ...process.env };
  Object.assign(process.env, env);
  try {
    return new JwtAuthGuard(jwt);
  } finally {
    // Restaura já: o guard congela a decisão no construtor, então o env não
    // precisa continuar sujo — e deixá-lo sujo contaminaria os outros testes.
    for (const key of Object.keys(env)) delete process.env[key];
    Object.assign(process.env, original);
  }
}

const jwtFake = (payload?: { sub: string }) =>
  ({
    verifyAsync: jest.fn(async () => {
      if (!payload) throw new Error('token inválido');
      return payload;
    }),
  }) as unknown as JwtService;

describe('JwtAuthGuard', () => {
  describe('sem bypass: o cookie manda', () => {
    const noBypass = { DEV_AUTH_BYPASS: undefined, DEV_AUTH_USER_ID: undefined };

    it('aceita cookie válido e populia o userId', async () => {
      const guard = guardWith(noBypass, jwtFake({ sub: USER }));
      const { ctx, req } = contextWith({ proplan_session: 'tok' });

      await expect(guard.canActivate(ctx)).resolves.toBe(true);
      expect(req.userId).toBe(USER);
    });

    it('recusa sem cookie', async () => {
      const guard = guardWith(noBypass, jwtFake({ sub: USER }));
      const { ctx } = contextWith({});

      await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });

    it('recusa cookie inválido/expirado', async () => {
      const guard = guardWith(noBypass, jwtFake(undefined));
      const { ctx } = contextWith({ proplan_session: 'estragado' });

      await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });
  });

  describe('com bypass ligado em DEV', () => {
    const bypassOn = {
      NODE_ENV: 'development',
      DEV_AUTH_BYPASS: 'true',
      DEV_AUTH_USER_ID: USER,
    };

    it('entra SEM cookie nenhum, assumindo o usuário configurado', async () => {
      const guard = guardWith(bypassOn, jwtFake(undefined));
      const { ctx, req } = contextWith({});

      await expect(guard.canActivate(ctx)).resolves.toBe(true);
      expect(req.userId).toBe(USER);
    });

    it('ignora o cookie mesmo quando ele existe e é inválido', async () => {
      const guard = guardWith(bypassOn, jwtFake(undefined));
      const { ctx, req } = contextWith({ proplan_session: 'lixo' });

      await expect(guard.canActivate(ctx)).resolves.toBe(true);
      expect(req.userId).toBe(USER);
    });
  });

  describe('produção ignora o bypass', () => {
    it('recusa sem cookie mesmo com a flag ligada por engano', async () => {
      // O cenário do acidente: `.env` de dev copiado para produção.
      const guard = guardWith(
        {
          NODE_ENV: 'production',
          DEV_AUTH_BYPASS: 'true',
          DEV_AUTH_USER_ID: USER,
        },
        jwtFake(undefined),
      );
      const { ctx, req } = contextWith({});

      await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
      expect(req.userId).toBeUndefined();
    });

    it('continua exigindo cookie VÁLIDO em produção', async () => {
      const guard = guardWith(
        {
          NODE_ENV: 'production',
          DEV_AUTH_BYPASS: 'true',
          DEV_AUTH_USER_ID: USER,
        },
        jwtFake({ sub: 'outro-usuario' }),
      );
      const { ctx, req } = contextWith({ proplan_session: 'tok' });

      // Entra pelo cookie, e como o usuário do COOKIE — nunca o do bypass.
      await expect(guard.canActivate(ctx)).resolves.toBe(true);
      expect(req.userId).toBe('outro-usuario');
    });
  });
});
