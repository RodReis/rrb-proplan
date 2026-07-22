import type { Response } from 'express';
import { AuthController } from './auth.controller';
import type { AuthService } from '../application/auth.service';

/**
 * Cookie de sessão em produção (SPEC-027).
 *
 * O que se prova: `secure` acompanha NODE_ENV. Sem isso o cookie de sessão
 * viajaria em claro num downgrade para http — e em dev um cookie Secure seria
 * descartado pelo browser, quebrando o login local.
 */
type CookieCall = { name: string; options: Record<string, unknown> };

function makeRes() {
  const cookies: CookieCall[] = [];
  const cleared: CookieCall[] = [];
  const res = {
    cookie: (name: string, _value: string, options: Record<string, unknown>) => {
      cookies.push({ name, options });
    },
    clearCookie: (name: string, options: Record<string, unknown> = {}) => {
      cleared.push({ name, options });
    },
    redirect: () => undefined,
    status: () => res,
    send: () => undefined,
  } as unknown as Response;
  return { res, cookies, cleared };
}

const auth = {
  createState: () => 'estado-fixo',
  loginUrl: () => 'https://github.com/login/oauth/authorize',
} as unknown as AuthService;

describe('AuthController — flags de cookie por ambiente', () => {
  const originalEnv = process.env.NODE_ENV;
  afterEach(() => {
    process.env.NODE_ENV = originalEnv;
    jest.resetModules();
  });

  // As flags são resolvidas quando o módulo carrega, então o teste reimporta o
  // controller com o NODE_ENV desejado — não basta reatribuir a env aqui.
  function controllerComEnv(env: string) {
    process.env.NODE_ENV = env;
    jest.resetModules();
    const mod = require('./auth.controller') as {
      AuthController: typeof AuthController;
    };
    return new mod.AuthController(auth);
  }

  it('produção → cookie de state com Secure, HttpOnly e SameSite=Lax', () => {
    const { res, cookies } = makeRes();
    controllerComEnv('production').login(res);

    expect(cookies).toHaveLength(1);
    expect(cookies[0].options).toMatchObject({
      httpOnly: true,
      sameSite: 'lax',
      secure: true,
    });
  });

  it('dev → sem Secure (senão o browser descarta o cookie em http://localhost)', () => {
    const { res, cookies } = makeRes();
    controllerComEnv('development').login(res);

    expect(cookies[0].options).toMatchObject({ secure: false, httpOnly: true });
  });

  // O browser só remove um cookie quando os atributos batem com os do set.
  it('logout limpa a sessão com as MESMAS flags do set', () => {
    const { res, cleared } = makeRes();
    controllerComEnv('production').logout(res);

    expect(cleared).toHaveLength(1);
    expect(cleared[0].name).toBe('proplan_session');
    expect(cleared[0].options).toMatchObject({
      httpOnly: true,
      sameSite: 'lax',
      secure: true,
    });
  });
});
